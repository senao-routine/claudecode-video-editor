/**
 * Zip up `output/edit/<name>/` into a single archive so the bundle can be
 * carried to another machine (or uploaded to cloud storage).
 *
 * Uses the system `zip` command which ships with macOS — no extra npm
 * package needed. The archive is written to `output/edit/<name>.zip`.
 *
 * Usage: npm run archive -- input/demo.mp4
 *    or: npm run archive -- demo
 */

import fs from "node:fs";
import path from "node:path";
import { OUTPUT_EDIT_DIR } from "./lib/paths.js";
import { run } from "./lib/shell.js";

function resolveBase(arg: string): string {
  return path.basename(arg, path.extname(arg));
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npm run archive -- <input-video-or-basename>");
    process.exit(1);
  }

  const base = resolveBase(arg);
  const srcDir = path.join(OUTPUT_EDIT_DIR, base);

  if (!fs.existsSync(srcDir)) {
    console.error(
      `[archive] ${srcDir} does not exist. Run /video-export-edit first.`,
    );
    process.exit(1);
  }

  const zipPath = path.join(OUTPUT_EDIT_DIR, `${base}.zip`);

  // Remove any stale archive first to ensure we get a clean result
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log(`[archive] zipping ${srcDir}`);
  // `-r` recursive, `-q` quiet, `-9` max compression
  // Run from OUTPUT_EDIT_DIR so paths inside the zip are relative to <name>/
  await run("zip", ["-r", "-q", "-9", `${base}.zip`, base], {
    cwd: OUTPUT_EDIT_DIR,
  });

  const size = fs.statSync(zipPath).size;
  console.log(`[archive] → ${zipPath} (${formatSize(size)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
