import { run } from "./shell.js";
import fs from "node:fs";
import path from "node:path";

export interface SilenceRange {
  start: number;
  end: number;
}

export interface SpeechRange {
  start: number;
  end: number;
}

/**
 * Probe a media file with ffprobe and return its duration in seconds.
 */
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { quiet: true },
  );
  return parseFloat(stdout.trim());
}

/**
 * Extract mono 16 kHz WAV audio. Whisper wants this format and it keeps
 * downstream silence detection cheap.
 */
export async function extractAudio(video: string, outWav: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-i",
    video,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outWav,
  ]);
}

/**
 * Two-pass loudnorm to EBU R128 (-16 LUFS target, standard for YouTube/podcast).
 * Writes a normalized WAV that the rest of the pipeline uses as the canonical
 * audio track.
 */
export async function loudnorm(inputWav: string, outWav: string): Promise<void> {
  // Pass 1: measure
  const { stderr: measureLog } = await run(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputWav,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { quiet: true, allowNonZero: true },
  );
  const jsonMatch = measureLog.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error("loudnorm pass 1 did not return JSON");
  const stats = JSON.parse(jsonMatch[0]);

  // Pass 2: apply
  const filter =
    `loudnorm=I=-16:TP=-1.5:LRA=11:` +
    `measured_I=${stats.input_i}:` +
    `measured_TP=${stats.input_tp}:` +
    `measured_LRA=${stats.input_lra}:` +
    `measured_thresh=${stats.input_thresh}:` +
    `offset=${stats.target_offset}:linear=true`;
  await run("ffmpeg", ["-y", "-i", inputWav, "-af", filter, outWav]);
}

/**
 * Parse ffmpeg `silencedetect` filter output into silence ranges.
 */
export async function detectSilences(
  audio: string,
  noiseDb: number,
  minDurationSec: number,
): Promise<SilenceRange[]> {
  const { stderr } = await run(
    "ffmpeg",
    [
      "-i",
      audio,
      "-af",
      `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
      "-f",
      "null",
      "-",
    ],
    { quiet: true, allowNonZero: true },
  );

  const silences: SilenceRange[] = [];
  const startRe = /silence_start:\s*([\d.]+)/g;
  const endRe = /silence_end:\s*([\d.]+)/g;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of stderr.matchAll(startRe)) starts.push(parseFloat(m[1]));
  for (const m of stderr.matchAll(endRe)) ends.push(parseFloat(m[1]));
  for (let i = 0; i < starts.length; i++) {
    const end = ends[i] ?? Number.POSITIVE_INFINITY;
    silences.push({ start: starts[i], end });
  }
  return silences;
}

/**
 * Invert silence ranges → speech ranges, optionally padding each speech
 * segment so we don't clip the leading/trailing consonants during jet cut.
 */
export function silencesToSpeechRanges(
  silences: SilenceRange[],
  totalDuration: number,
  padSec: number,
): SpeechRange[] {
  const ranges: SpeechRange[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) {
      ranges.push({ start: cursor, end: s.start });
    }
    cursor = Math.min(s.end, totalDuration);
  }
  if (cursor < totalDuration) {
    ranges.push({ start: cursor, end: totalDuration });
  }
  // Apply padding and merge overlapping
  const padded = ranges.map((r) => ({
    start: Math.max(0, r.start - padSec),
    end: Math.min(totalDuration, r.end + padSec),
  }));
  const merged: SpeechRange[] = [];
  for (const r of padded) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * Cut a source video down to a list of speech ranges and concatenate them
 * into a single output file.
 *
 * Implementation: a SINGLE-PASS ffmpeg invocation using a `filter_complex`
 * graph of `trim`/`atrim` per range followed by a `concat` filter. This is
 * the only approach that:
 *   1. Guarantees the output duration exactly matches the sum of
 *      `range.end - range.start` (no ~1-frame-per-segment drift from the
 *      old segment-then-concat approach).
 *   2. Keeps audio and video aligned perfectly at every cut.
 *   3. Produces clean, edit-list-free mp4 timestamps that Premiere Pro
 *      parses correctly.
 *
 * Output format is tuned for Premiere Pro / Filmora / DaVinci:
 *   - 30 fps CFR video, yuv420p, h264, timescale 1/30000
 *   - 48 kHz stereo AAC audio
 *   - No edit list, no negative DTS.
 *
 * For very large range counts (hundreds) the filter_complex string becomes
 * long but ffmpeg handles it fine — the filter graph lives in process
 * memory and there's no command-line length issue on macOS.
 */
export async function jetcutConcat(
  source: string,
  ranges: SpeechRange[],
  outFile: string,
  _workDir: string,
): Promise<void> {
  if (ranges.length === 0) throw new Error("No speech ranges to cut");

  // Build one trim + atrim pair per kept range, each rebased to PTS 0,
  // then concat them all together in a single operation.
  const parts: string[] = [];
  const concatInputs: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    const s = start.toFixed(3);
    const e = end.toFixed(3);
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  }
  parts.push(
    `${concatInputs.join("")}concat=n=${ranges.length}:v=1:a=1[outv][outa]`,
  );
  const filterComplex = parts.join(";");

  await run("ffmpeg", [
    "-y",
    "-i",
    source,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-r",
    "30",
    "-vsync",
    "cfr",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-b:a",
    "192k",
    "-avoid_negative_ts",
    "make_zero",
    "-video_track_timescale",
    "30000",
    "-movflags",
    "+faststart",
    outFile,
  ]);
}

/**
 * Split an audio file into fixed-length chunks for parallel Whisper uploads.
 * Returns the chunk file paths and their start offsets (seconds).
 */
export async function splitAudio(
  audio: string,
  chunkSec: number,
  outDir: string,
): Promise<Array<{ file: string; offset: number }>> {
  const duration = await probeDuration(audio);
  const chunks: Array<{ file: string; offset: number }> = [];
  let idx = 0;
  for (let offset = 0; offset < duration; offset += chunkSec) {
    const file = path.join(outDir, `chunk_${String(idx).padStart(4, "0")}.wav`);
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(offset),
      "-t",
      String(chunkSec),
      "-i",
      audio,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      file,
    ]);
    chunks.push({ file, offset });
    idx++;
  }
  return chunks;
}

/**
 * Crop a 16:9 source to 9:16 (vertical short). Centers the crop, scales
 * to 1080×1920, and burns in a subtitle file if provided.
 */
export async function cropToVertical(
  source: string,
  outFile: string,
  opts: { burnSubtitles?: string; startSec?: number; endSec?: number } = {},
): Promise<void> {
  // crop the center 9:16 region, then scale to 1080x1920
  let vf = "crop=ih*9/16:ih,scale=1080:1920";
  if (opts.burnSubtitles) {
    // Escape special chars for ffmpeg filter parser
    const escaped = opts.burnSubtitles.replace(/:/g, "\\:").replace(/'/g, "\\'");
    vf += `,subtitles='${escaped}'`;
  }
  const args: string[] = ["-y"];
  if (opts.startSec !== undefined) args.push("-ss", String(opts.startSec));
  if (opts.endSec !== undefined) args.push("-to", String(opts.endSec));
  args.push(
    "-i",
    source,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outFile,
  );
  await run("ffmpeg", args);
}
