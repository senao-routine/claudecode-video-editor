/**
 * Stage 2 — Jet cut.
 *
 * Reads silences.json from Stage 1, inverts them into speech ranges, pads
 * each range a bit to avoid clipping, and concatenates the kept ranges into
 * a single tight video.
 *
 * Usage: npm run jetcut -- input/demo.mp4
 */

import fs from "node:fs";
import path from "node:path";
import { ensureWorkspace } from "./lib/paths.js";
import {
  silencesToSpeechRanges,
  jetcutConcat,
  type SilenceRange,
} from "./lib/ffmpeg.js";
import { config } from "./lib/config.js";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run jetcut -- <input-video>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  const ws = ensureWorkspace(absInput);

  if (!fs.existsSync(ws.silences)) {
    console.error(
      `silences.json not found — run npm run preprocess -- ${input} first`,
    );
    process.exit(1);
  }

  const { duration, silences } = JSON.parse(
    fs.readFileSync(ws.silences, "utf8"),
  ) as { duration: number; silences: SilenceRange[] };

  const speech = silencesToSpeechRanges(
    silences,
    duration,
    config.pipeline.jetcutPadSec,
  );
  const keptSec = speech.reduce((acc, r) => acc + (r.end - r.start), 0);
  console.log(
    `[jetcut] original ${duration.toFixed(1)}s → kept ${keptSec.toFixed(1)}s (${((keptSec / duration) * 100).toFixed(1)}%) across ${speech.length} segments`,
  );

  // Persist the cut plan for downstream stages (B-roll, short video)
  // that need to remap original-timeline offsets to post-cut offsets.
  fs.writeFileSync(
    ws.cutPlan,
    JSON.stringify(
      {
        originalDuration: duration,
        jetcutDuration: keptSec,
        ranges: speech,
      },
      null,
      2,
    ),
  );

  await jetcutConcat(absInput, speech, ws.jetcut, ws.dir);
  console.log(`[jetcut] → ${ws.jetcut}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
