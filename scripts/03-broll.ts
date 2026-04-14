/**
 * Stage 3 — B-roll planning + generation.
 *
 * 1. Gemini reads the transcript and picks 3–8 B-roll moments.
 * 2. For each "image" moment: Gemini generates the still immediately.
 * 3. For each "video" moment: we write a `renoise_requests.json` file with
 *    the prompts so Claude Code can fulfil them via the
 *    `video-maker:renoise-gen` skill, then drop the results into
 *    `work/<name>/broll/`.
 * 4. Timestamps are remapped to the post-jetcut timeline and persisted as
 *    `broll_plan.json` for the Remotion composition to consume.
 *
 * Usage: npm run broll -- input/demo.mp4
 */

import fs from "node:fs";
import path from "node:path";
import { ensureWorkspace } from "./lib/paths.js";
import {
  planBRoll,
  generateImage,
  buildVideoPromptForRenoise,
  type BRollMoment,
} from "./lib/gemini.js";
import { makeTimelineMapper } from "./lib/timeline.js";
import type { Transcript } from "./lib/whisper.js";
import type { SpeechRange } from "./lib/ffmpeg.js";

interface PlannedBRoll extends BRollMoment {
  id: string;
  /** Timestamps on the post-jetcut timeline. */
  cutStartSec: number;
  cutEndSec: number;
  /** Relative path to the asset within work/<name>/broll/, if produced. */
  assetFile?: string;
  /** For video kind: whether the Renoise job has been fulfilled yet. */
  needsRenoise?: boolean;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run broll -- <input-video>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  const ws = ensureWorkspace(absInput);

  if (!fs.existsSync(ws.transcript) || !fs.existsSync(ws.cutPlan)) {
    console.error(
      `Missing transcript or cut plan — run preprocess and jetcut first.`,
    );
    process.exit(1);
  }

  const transcript = JSON.parse(fs.readFileSync(ws.transcript, "utf8")) as Transcript;
  const { ranges } = JSON.parse(fs.readFileSync(ws.cutPlan, "utf8")) as {
    ranges: SpeechRange[];
  };
  const { snapOriginalToCut } = makeTimelineMapper(ranges);

  console.log("[broll] asking Gemini to plan B-roll moments…");
  const moments = await planBRoll(transcript);
  console.log(`[broll] Gemini returned ${moments.length} moments`);

  const planned: PlannedBRoll[] = moments.map((m, i) => ({
    ...m,
    id: `broll_${String(i).padStart(2, "0")}`,
    cutStartSec: snapOriginalToCut(m.startSec),
    cutEndSec: snapOriginalToCut(m.endSec),
  }));

  // Generate images immediately, queue videos for the Renoise skill.
  const renoiseQueue: PlannedBRoll[] = [];
  for (const p of planned) {
    if (p.kind === "image") {
      const outFile = path.join(ws.brollDir, `${p.id}.png`);
      console.log(`[broll] generating image ${p.id}: ${p.topic}`);
      try {
        await generateImage(p.imagePrompt, outFile);
        p.assetFile = path.relative(ws.dir, outFile);
      } catch (e) {
        console.error(`[broll] image generation failed for ${p.id}:`, e);
      }
    } else {
      p.needsRenoise = true;
      renoiseQueue.push(p);
    }
  }

  fs.writeFileSync(ws.brollPlan, JSON.stringify(planned, null, 2));
  console.log(`[broll] plan → ${ws.brollPlan}`);

  if (renoiseQueue.length > 0) {
    // Drop a request file the user (or Claude Code) can pick up and run
    // through the video-maker:renoise-gen skill. Place each finished clip
    // at work/<name>/broll/<id>.mp4 and flip needsRenoise=false in the plan.
    // The prompts already include the project's video style guide (Japanese
    // text, motion-graphics look) appended by buildVideoPromptForRenoise().
    const reqFile = path.join(ws.dir, "renoise_requests.json");
    fs.writeFileSync(
      reqFile,
      JSON.stringify(
        renoiseQueue.map((p) => ({
          id: p.id,
          prompt: buildVideoPromptForRenoise(p.videoPrompt),
          durationSec: Math.max(3, Math.min(8, p.endSec - p.startSec)),
          aspectRatio: "16:9",
          outputPath: path.join(ws.brollDir, `${p.id}.mp4`),
        })),
        null,
        2,
      ),
    );
    console.log(
      `[broll] ${renoiseQueue.length} video moments queued → ${reqFile}\n` +
        `        Ask Claude to run video-maker:renoise-gen for each entry, then re-run this script to mark them as fulfilled.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
