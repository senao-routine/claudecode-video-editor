/**
 * Stage 1 — Preprocess.
 *
 * Reads an input video and produces the shared artifacts every downstream
 * stage (jetcut, main, short) depends on:
 *
 *   work/<name>/audio.wav              raw mono 16 kHz extraction
 *   work/<name>/audio_normalized.wav   EBU R128 loudness-normalized
 *   work/<name>/silences.json          silence ranges from ffmpeg silencedetect
 *   work/<name>/transcript.json        Whisper verbose_json (segment+word level)
 *
 * Usage:  npm run preprocess -- input/demo.mp4
 */

import fs from "node:fs";
import path from "node:path";
import { ensureWorkspace } from "./lib/paths.js";
import {
  extractAudio,
  loudnorm,
  detectSilences,
  probeDuration,
} from "./lib/ffmpeg.js";
import { transcribe } from "./lib/whisper.js";
import { config } from "./lib/config.js";
import { writeTranscriptEdit } from "./lib/transcript-edit.js";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run preprocess -- <input-video>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  if (!fs.existsSync(absInput)) {
    console.error(`input not found: ${absInput}`);
    process.exit(1);
  }

  const ws = ensureWorkspace(absInput);
  console.log(`[preprocess] workspace: ${ws.dir}`);

  // 1. Extract audio (mono 16 kHz) — skip if cached
  if (!fs.existsSync(ws.audio)) {
    console.log("[preprocess] extracting audio…");
    await extractAudio(absInput, ws.audio);
  } else {
    console.log("[preprocess] audio cached, skipping extraction");
  }

  // 2. Loudness-normalize
  if (!fs.existsSync(ws.audioNormalized)) {
    console.log("[preprocess] loudness normalization (two-pass)…");
    await loudnorm(ws.audio, ws.audioNormalized);
  } else {
    console.log("[preprocess] normalized audio cached, skipping");
  }

  // 3. Detect silences on the normalized track
  console.log(
    `[preprocess] detecting silences (noise=${config.pipeline.silenceNoiseDb} dB, d=${config.pipeline.silenceMinDurationSec} s)…`,
  );
  const silences = await detectSilences(
    ws.audioNormalized,
    config.pipeline.silenceNoiseDb,
    config.pipeline.silenceMinDurationSec,
  );
  const duration = await probeDuration(absInput);
  fs.writeFileSync(
    ws.silences,
    JSON.stringify({ duration, silences }, null, 2),
  );
  console.log(`[preprocess] ${silences.length} silence ranges → ${ws.silences}`);

  // 4. Whisper transcribe (chunked)
  if (!fs.existsSync(ws.transcript)) {
    console.log("[preprocess] transcribing with Whisper (may take a while)…");
    const transcript = await transcribe(ws.audioNormalized, ws.dir);
    fs.writeFileSync(ws.transcript, JSON.stringify(transcript, null, 2));
    console.log(
      `[preprocess] transcript: ${transcript.segments.length} segments, ${transcript.words.length} words → ${ws.transcript}`,
    );
  } else {
    console.log("[preprocess] transcript cached, skipping Whisper call");
  }

  // 5. Write the human-editable transcript form (if not already present).
  // The user can hand-fix katakana/proper noun mistakes in this file before
  // running the main render — applyTranscriptEdit() picks it up automatically.
  if (!fs.existsSync(ws.transcriptEdit)) {
    const transcript = JSON.parse(fs.readFileSync(ws.transcript, "utf8"));
    writeTranscriptEdit(transcript, ws.transcriptEdit);
    console.log(`[preprocess] editable transcript → ${ws.transcriptEdit}`);
    console.log(
      "[preprocess] 文字起こしを修正したい場合は上記ファイルを編集してから本編動画を再生成してください。",
    );
  } else {
    console.log("[preprocess] editable transcript already exists, leaving user edits intact");
  }

  console.log("[preprocess] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
