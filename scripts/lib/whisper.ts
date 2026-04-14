import fs from "node:fs";
import OpenAI from "openai";
import { config } from "./config.js";
import { splitAudio } from "./ffmpeg.js";
import path from "node:path";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  language: string;
  segments: TranscriptSegment[];
  words: WordTimestamp[];
}

/**
 * Transcribe an audio file with Whisper, chunking it to stay under the
 * 25 MB API limit and re-aligning timestamps to the original timeline.
 *
 * We use `verbose_json` + `word` granularity so downstream steps (subtitle
 * rendering, highlight detection) can align cuts to word boundaries.
 */
export async function transcribe(audioFile: string, workDir: string): Promise<Transcript> {
  const client = new OpenAI({ apiKey: config.openai.apiKey });

  const chunkDir = path.join(workDir, "whisper_chunks");
  fs.mkdirSync(chunkDir, { recursive: true });
  const chunks = await splitAudio(audioFile, config.pipeline.whisperChunkSec, chunkDir);

  const allSegments: TranscriptSegment[] = [];
  const allWords: WordTimestamp[] = [];
  let fullText = "";
  let language = "";
  let segIdCursor = 0;

  for (const { file, offset } of chunks) {
    const result = (await client.audio.transcriptions.create({
      file: fs.createReadStream(file),
      model: config.openai.whisperModel,
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    })) as unknown as {
      text: string;
      language: string;
      segments: Array<{ id: number; start: number; end: number; text: string }>;
      words: Array<{ word: string; start: number; end: number }>;
    };

    if (!language) language = result.language;
    fullText += (fullText ? " " : "") + result.text;

    for (const seg of result.segments ?? []) {
      allSegments.push({
        id: segIdCursor++,
        start: seg.start + offset,
        end: seg.end + offset,
        text: seg.text,
      });
    }
    for (const w of result.words ?? []) {
      allWords.push({
        word: w.word,
        start: w.start + offset,
        end: w.end + offset,
      });
    }
  }

  // Clean up chunk files — they can be big.
  for (const { file } of chunks) fs.unlinkSync(file);
  fs.rmdirSync(chunkDir);

  return {
    text: fullText,
    language,
    segments: allSegments,
    words: allWords,
  };
}

/**
 * Convert a transcript's segments into an SRT subtitle file.
 */
export function transcriptToSrt(transcript: Transcript): string {
  function fmt(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }
  return transcript.segments
    .map((seg, i) => `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text.trim()}\n`)
    .join("\n");
}

/**
 * Convert a transcript to an ASS subtitle file with styling tuned for
 * vertical short-form video (large, bold, bottom-center with outline).
 */
export function transcriptToAss(
  transcript: Transcript,
  opts: { fontSize?: number; marginV?: number } = {},
): string {
  const fontSize = opts.fontSize ?? 72;
  const marginV = opts.marginV ?? 320;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK JP,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  function fmt(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const whole = Math.floor(s);
    const cs = Math.floor((s - whole) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  const events = transcript.segments
    .map(
      (seg) =>
        `Dialogue: 0,${fmt(seg.start)},${fmt(seg.end)},Default,,0,0,0,,${seg.text.trim().replace(/\n/g, " ")}`,
    )
    .join("\n");

  return header + events + "\n";
}
