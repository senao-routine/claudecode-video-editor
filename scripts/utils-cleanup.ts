/**
 * Delete the work/<name>/ cache for a given input video. Never touches
 * `output/` — finished renders, edit bundles, and shorts are always kept.
 *
 * Usage: npm run cleanup -- input/demo.mp4
 *    or: npm run cleanup -- demo                 (bare basename also OK)
 */

import fs from "node:fs";
import path from "node:path";
import { WORK_DIR } from "./lib/paths.js";

function resolveBase(arg: string): string {
  // Accept "input/demo.mp4" or a bare "demo" — strip dir + extension.
  const basename = path.basename(arg, path.extname(arg));
  return basename;
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSizeBytes(full);
    else if (e.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npm run cleanup -- <input-video-or-basename>");
    process.exit(1);
  }

  const base = resolveBase(arg);
  const target = path.join(WORK_DIR, base);

  if (!fs.existsSync(target)) {
    console.log(`[cleanup] nothing to delete — ${target} does not exist`);
    return;
  }

  const size = dirSizeBytes(target);
  console.log(`[cleanup] deleting ${target} (${formatSize(size)})`);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[cleanup] done — freed ${formatSize(size)}`);
  console.log(
    `[cleanup] output/ files for "${base}" are preserved (main, shorts, edit)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
