/**
 * Stage 4 — Main video render.
 *
 * Orchestrates: preprocess → jetcut → broll plan → Remotion render.
 * Skips any stage whose output is already cached.
 *
 * Usage: npm run main -- input/demo.mp4
 */

import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  ensureWorkspace,
  OUTPUT_MAIN_DIR,
  REMOTION_ENTRY,
} from "./lib/paths.js";
import { probeDuration } from "./lib/ffmpeg.js";
import { remapTranscript } from "./lib/timeline.js";
import { run } from "./lib/shell.js";
import { loadStyle, chunkTranscript } from "./lib/style.js";
import { applyTranscriptEdit } from "./lib/transcript-edit.js";
import type { Transcript } from "./lib/whisper.js";
import type { SpeechRange } from "./lib/ffmpeg.js";

async function runStage(name: string, cmd: string, args: string[]) {
  console.log(`\n=== ${name} ===`);
  await run(cmd, args);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run main -- <input-video>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  const ws = ensureWorkspace(absInput);

  const nodeBin = process.execPath;
  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");

  // 1. preprocess (cached)
  if (!fs.existsSync(ws.transcript)) {
    await runStage("preprocess", tsxBin, ["scripts/01-preprocess.ts", absInput]);
  } else {
    console.log("[main] preprocess cached");
  }

  // 2. jetcut (cached)
  if (!fs.existsSync(ws.jetcut) || !fs.existsSync(ws.cutPlan)) {
    await runStage("jetcut", tsxBin, ["scripts/02-jetcut.ts", absInput]);
  } else {
    console.log("[main] jetcut cached");
  }

  // 3. broll plan (re-runs if requested, otherwise cached)
  if (!fs.existsSync(ws.brollPlan)) {
    await runStage("broll", tsxBin, ["scripts/03-broll.ts", absInput]);
  } else {
    console.log("[main] broll plan cached");
  }

  // 4. Prepare Remotion input props
  // Load the raw transcript, then apply any manual edits the user may have
  // made in `transcript_edit.md` (fixes for katakana, proper nouns, etc.)
  // BEFORE remapping or wrapping. This way the user only edits one source
  // of truth and the rest of the pipeline stays consistent.
  const rawTranscript = JSON.parse(fs.readFileSync(ws.transcript, "utf8")) as Transcript;
  const editedTranscript = applyTranscriptEdit(rawTranscript, ws.transcriptEdit);
  const { ranges } = JSON.parse(fs.readFileSync(ws.cutPlan, "utf8")) as {
    ranges: SpeechRange[];
  };
  const style = loadStyle();
  // Remap timestamps to post-jetcut timeline AND chunk each segment into
  // short, readable pieces (per `subtitles.chunking` in config/style.json).
  // The on-screen font size stays constant; long sentences are shown by
  // flipping through multiple short chunks instead of shrinking the text.
  const cutTranscript = chunkTranscript(
    remapTranscript(editedTranscript, ranges),
    style.subtitles.chunking,
  );

  const brollPlan = JSON.parse(fs.readFileSync(ws.brollPlan, "utf8")) as Array<{
    id: string;
    kind: "image" | "video";
    displayMode?: "pip" | "fullscreen";
    cutStartSec: number;
    cutEndSec: number;
    topic: string;
    assetFile?: string;
    needsRenoise?: boolean;
  }>;

  // Asset paths must be RELATIVE to the Remotion publicDir (which we point
  // at the workspace folder below). The components wrap them with
  // staticFile() so Remotion serves them via its built-in HTTP server.
  const brollForRemotion = brollPlan
    .filter((b) => !b.needsRenoise)
    .map((b) => {
      const relAssetFile = b.assetFile
        ? b.assetFile
        : b.kind === "video"
          ? `broll/${b.id}.mp4`
          : `broll/${b.id}.png`;
      const absAsset = path.join(ws.dir, relAssetFile);
      return {
        id: b.id,
        kind: b.kind,
        displayMode: b.displayMode ?? style.broll.defaultMode,
        cutStartSec: b.cutStartSec,
        cutEndSec: b.cutEndSec,
        topic: b.topic,
        assetUrl: fs.existsSync(absAsset) ? relAssetFile : null,
      };
    });

  const pending = brollPlan.filter(
    (b) =>
      b.needsRenoise ||
      !fs.existsSync(
        b.assetFile
          ? path.join(ws.dir, b.assetFile)
          : b.kind === "video"
            ? path.join(ws.brollDir, `${b.id}.mp4`)
            : path.join(ws.brollDir, `${b.id}.png`),
      ),
  );
  if (pending.length > 0) {
    console.warn(
      `[main] ${pending.length} B-roll assets are still missing (likely Renoise jobs). They will be omitted from this render. Rerun after fulfilling:`,
    );
    for (const p of pending) console.warn(`  - ${p.id} (${p.kind})`);
  }

  const jetcutDuration = await probeDuration(ws.jetcut);

  // 5. Bundle Remotion project and render MainVideo
  // Point publicDir at the workspace so jetcut.mp4 and broll/ are served via
  // Remotion's static file server (referenced by staticFile() in components).
  console.log("\n=== bundling Remotion project ===");
  const bundled = await bundle({
    entryPoint: REMOTION_ENTRY,
    publicDir: ws.dir,
    webpackOverride: (cfg) => cfg,
  });

  const inputProps = {
    videoUrl: path.basename(ws.jetcut),
    durationSec: jetcutDuration,
    fps: 30,
    transcript: cutTranscript,
    broll: brollForRemotion,
    style,
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "MainVideo",
    inputProps,
  });

  const outFile = path.join(OUTPUT_MAIN_DIR, `${ws.base}_main.mp4`);
  console.log(`\n=== rendering MainVideo → ${outFile} ===`);
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outFile,
    inputProps,
  });

  console.log(`\n[main] done → ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
