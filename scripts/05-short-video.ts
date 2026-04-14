/**
 * Stage 5 — Short video extractor.
 *
 * 1. Runs preprocess + jetcut if not cached.
 * 2. Asks Gemini to pick highlight windows from the transcript (post-cut timeline).
 * 3. For each highlight, slices the jetcut video into a temporary clip,
 *    crops to 9:16 vertical, and renders the Remotion `ShortVideo`
 *    composition with title/hook overlays and caption layer.
 *
 * Usage: npm run short -- input/demo.mp4 [count]
 *   count defaults to 2
 */

import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { loadStyle, chunkTranscript } from "./lib/style.js";
import { applyTranscriptEdit } from "./lib/transcript-edit.js";
import {
  ensureWorkspace,
  OUTPUT_SHORTS_DIR,
  REMOTION_ENTRY,
} from "./lib/paths.js";
import { probeDuration, cropToVertical } from "./lib/ffmpeg.js";
import { run } from "./lib/shell.js";
import { makeTimelineMapper, remapTranscript } from "./lib/timeline.js";
import { planHighlights, type Highlight } from "./lib/gemini.js";
import type { Transcript, TranscriptSegment } from "./lib/whisper.js";
import type { SpeechRange } from "./lib/ffmpeg.js";

async function runStage(name: string, cmd: string, args: string[]) {
  console.log(`\n=== ${name} ===`);
  await run(cmd, args);
}

/**
 * Slice a transcript down to a [startSec, endSec] window and rebase its
 * timestamps to zero (so the short's own timeline starts at 0).
 */
function sliceTranscript(
  transcript: Transcript,
  startSec: number,
  endSec: number,
): Transcript {
  const segments: TranscriptSegment[] = [];
  for (const seg of transcript.segments) {
    if (seg.end < startSec || seg.start > endSec) continue;
    segments.push({
      id: segments.length,
      start: Math.max(0, seg.start - startSec),
      end: Math.min(endSec - startSec, seg.end - startSec),
      text: seg.text,
    });
  }
  const words = transcript.words
    .filter((w) => w.start >= startSec && w.end <= endSec)
    .map((w) => ({
      word: w.word,
      start: w.start - startSec,
      end: w.end - startSec,
    }));
  return { text: transcript.text, language: transcript.language, segments, words };
}

async function main() {
  const input = process.argv[2];
  const count = parseInt(process.argv[3] ?? "2", 10);
  if (!input) {
    console.error("usage: npm run short -- <input-video> [count]");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  const ws = ensureWorkspace(absInput);
  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");

  // Ensure preprocess + jetcut are done
  if (!fs.existsSync(ws.transcript)) {
    await runStage("preprocess", tsxBin, ["scripts/01-preprocess.ts", absInput]);
  }
  if (!fs.existsSync(ws.jetcut) || !fs.existsSync(ws.cutPlan)) {
    await runStage("jetcut", tsxBin, ["scripts/02-jetcut.ts", absInput]);
  }

  // Load raw transcript, apply manual edits from transcript_edit.md,
  // remap to the post-jetcut timeline, then chunk into short readable
  // pieces (per `subtitles.chunking` in config/style.json).
  const rawTranscript = JSON.parse(fs.readFileSync(ws.transcript, "utf8")) as Transcript;
  const editedTranscript = applyTranscriptEdit(rawTranscript, ws.transcriptEdit);
  const { ranges } = JSON.parse(fs.readFileSync(ws.cutPlan, "utf8")) as {
    ranges: SpeechRange[];
  };
  const styleEarly = loadStyle();
  const cutTranscript = chunkTranscript(
    remapTranscript(editedTranscript, ranges),
    styleEarly.subtitles.chunking,
  );

  // Plan highlights (on post-cut timeline)
  let highlights: Highlight[];
  if (fs.existsSync(ws.highlights)) {
    console.log("[short] highlights cached");
    highlights = JSON.parse(fs.readFileSync(ws.highlights, "utf8"));
  } else {
    console.log(`[short] asking Gemini for ${count} highlights…`);
    // Re-run planHighlights against the post-cut transcript so start/end
    // times are already in post-cut coordinates.
    highlights = await planHighlights(cutTranscript, count);
    fs.writeFileSync(ws.highlights, JSON.stringify(highlights, null, 2));
  }
  console.log(`[short] ${highlights.length} highlights:`);
  for (const h of highlights)
    console.log(
      `  - [${h.startSec.toFixed(1)}-${h.endSec.toFixed(1)}s] ${h.title} — ${h.hookText}`,
    );

  const jetcutDuration = await probeDuration(ws.jetcut);

  // Pre-crop ALL highlights to vertical clips BEFORE bundling Remotion.
  // Remotion's publicDir is snapshotted at bundle time, so any file we
  // create after bundling will not be visible to staticFile() during
  // rendering.
  const prepared: Array<{
    h: typeof highlights[number];
    durationSec: number;
    tmpVerticalName: string;
    tmpVertical: string;
    sliceTs: ReturnType<typeof sliceTranscript>;
  }> = [];

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    const start = Math.max(0, h.startSec);
    const end = Math.min(jetcutDuration, h.endSec);
    const durationSec = end - start;
    const tmpVerticalName = `short_${i}_vertical.mp4`;
    const tmpVertical = path.join(ws.dir, tmpVerticalName);
    console.log(
      `\n[short ${i + 1}/${highlights.length}] cropping ${start.toFixed(1)}-${end.toFixed(1)}s to 9:16…`,
    );
    await cropToVertical(ws.jetcut, tmpVertical, {
      startSec: start,
      endSec: end,
    });
    const sliceTs = sliceTranscript(cutTranscript, start, end);
    prepared.push({ h, durationSec, tmpVerticalName, tmpVertical, sliceTs });
  }

  // Now bundle Remotion with the workspace as publicDir — all the cropped
  // vertical clips are present and will be copied into the bundle.
  console.log("\n=== bundling Remotion project ===");
  const bundled = await bundle({
    entryPoint: REMOTION_ENTRY,
    publicDir: ws.dir,
    webpackOverride: (cfg) => cfg,
  });

  for (let i = 0; i < prepared.length; i++) {
    const { h, durationSec, tmpVerticalName, tmpVertical, sliceTs } = prepared[i];
    const inputProps = {
      videoUrl: tmpVerticalName,
      durationSec,
      fps: 30,
      transcript: sliceTs,
      title: h.title,
      hookText: h.hookText,
      style: styleEarly,
    };

    const composition = await selectComposition({
      serveUrl: bundled,
      id: "ShortVideo",
      inputProps,
    });

    const slug = h.title.replace(/[\/\\?%*:|"<>\s]+/g, "_").slice(0, 30);
    const outFile = path.join(
      OUTPUT_SHORTS_DIR,
      `${ws.base}_short${i + 1}_${slug}.mp4`,
    );
    console.log(`\n[short ${i + 1}/${prepared.length}] rendering → ${outFile}`);
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: "h264",
      outputLocation: outFile,
      inputProps,
    });

    fs.unlinkSync(tmpVertical);
  }

  console.log(`\n[short] done. ${highlights.length} shorts in ${OUTPUT_SHORTS_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
