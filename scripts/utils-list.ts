/**
 * List every video that has artifacts under work/ or output/.
 *
 * For each known video, show which pipeline stages have cached output, how
 * much disk space it uses, and where the finished renders live.
 *
 * Usage: npm run list
 */

import fs from "node:fs";
import path from "node:path";
import {
  INPUT_DIR,
  WORK_DIR,
  OUTPUT_MAIN_DIR,
  OUTPUT_SHORTS_DIR,
  OUTPUT_EDIT_DIR,
} from "./lib/paths.js";

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSizeBytes(full);
      else if (e.isFile()) total += fs.statSync(full).size;
    } catch {
      // file may have been deleted mid-walk; ignore
    }
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface VideoRow {
  name: string;
  hasInput: boolean;
  workSize: number;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasEdit: boolean;
  hasJetcut: boolean;
  hasBrollPlan: boolean;
  brollAssetCount: number;
  mainSize: number;
  shortsCount: number;
  shortsSize: number;
  editSize: number;
}

function collectNames(): Set<string> {
  const names = new Set<string>();
  const addFromDir = (dir: string, isFile = false) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isFile) {
        if (e.isFile()) {
          const base = path.basename(e.name, path.extname(e.name));
          names.add(base);
        }
      } else if (e.isDirectory()) {
        names.add(e.name);
      }
    }
  };
  addFromDir(INPUT_DIR, true);
  addFromDir(WORK_DIR);
  addFromDir(OUTPUT_EDIT_DIR);
  // main/shorts are flat — strip suffix
  if (fs.existsSync(OUTPUT_MAIN_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_MAIN_DIR)) {
      if (f.endsWith("_main.mp4")) names.add(f.replace(/_main\.mp4$/, ""));
    }
  }
  if (fs.existsSync(OUTPUT_SHORTS_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_SHORTS_DIR)) {
      // "<base>_shortN_<slug>.mp4"
      const m = f.match(/^(.+?)_short\d+_/);
      if (m) names.add(m[1]);
    }
  }
  return names;
}

function inspect(name: string): VideoRow {
  const workDir = path.join(WORK_DIR, name);
  const inputExts = [".mp4", ".mov", ".mkv", ".m4v"];
  const hasInput = inputExts.some((ext) =>
    fs.existsSync(path.join(INPUT_DIR, name + ext)),
  );
  const hasAudio = fs.existsSync(path.join(workDir, "audio_normalized.wav"));
  const hasTranscript = fs.existsSync(path.join(workDir, "transcript.json"));
  const hasEdit = fs.existsSync(path.join(workDir, "transcript_edit.md"));
  const hasJetcut = fs.existsSync(path.join(workDir, "jetcut.mp4"));
  const hasBrollPlan = fs.existsSync(path.join(workDir, "broll_plan.json"));
  const brollDir = path.join(workDir, "broll");
  const brollAssetCount = fs.existsSync(brollDir)
    ? fs.readdirSync(brollDir).filter((f) => !f.startsWith(".")).length
    : 0;

  const mainFile = path.join(OUTPUT_MAIN_DIR, `${name}_main.mp4`);
  const mainSize = fs.existsSync(mainFile) ? fs.statSync(mainFile).size : 0;

  let shortsCount = 0;
  let shortsSize = 0;
  if (fs.existsSync(OUTPUT_SHORTS_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_SHORTS_DIR)) {
      if (f.startsWith(name + "_short")) {
        shortsCount++;
        shortsSize += fs.statSync(path.join(OUTPUT_SHORTS_DIR, f)).size;
      }
    }
  }

  const editDir = path.join(OUTPUT_EDIT_DIR, name);
  const editSize = dirSizeBytes(editDir);

  return {
    name,
    hasInput,
    workSize: dirSizeBytes(workDir),
    hasAudio,
    hasTranscript,
    hasEdit,
    hasJetcut,
    hasBrollPlan,
    brollAssetCount,
    mainSize,
    shortsCount,
    shortsSize,
    editSize,
  };
}

function statusGlyph(ok: boolean): string {
  return ok ? "✓" : "·";
}

async function main() {
  const names = [...collectNames()].sort();

  if (names.length === 0) {
    console.log("No videos found. Place a file in input/ and run /video-start.");
    return;
  }

  console.log(`\n=== Video artifacts overview ===\n`);

  const rows = names.map(inspect);

  // Compact per-video card format
  for (const r of rows) {
    console.log(`▶ ${r.name}`);
    const flags = [
      `input:${statusGlyph(r.hasInput)}`,
      `transcript:${statusGlyph(r.hasTranscript)}`,
      `edit:${statusGlyph(r.hasEdit)}`,
      `jetcut:${statusGlyph(r.hasJetcut)}`,
      `broll-plan:${statusGlyph(r.hasBrollPlan)}`,
      `broll-assets:${r.brollAssetCount}`,
    ].join("  ");
    console.log(`  ${flags}`);

    const outputs: string[] = [];
    if (r.mainSize > 0) outputs.push(`main (${formatSize(r.mainSize)})`);
    if (r.shortsCount > 0) {
      outputs.push(`shorts x${r.shortsCount} (${formatSize(r.shortsSize)})`);
    }
    if (r.editSize > 0) outputs.push(`edit bundle (${formatSize(r.editSize)})`);
    console.log(
      `  outputs: ${outputs.length > 0 ? outputs.join(" | ") : "—"}`,
    );
    console.log(`  work cache: ${formatSize(r.workSize)}`);
    console.log("");
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.work += r.workSize;
      acc.main += r.mainSize;
      acc.shorts += r.shortsSize;
      acc.edit += r.editSize;
      return acc;
    },
    { work: 0, main: 0, shorts: 0, edit: 0 },
  );

  console.log("────────────────────────────────────");
  console.log(
    `totals: work ${formatSize(totals.work)} | main ${formatSize(totals.main)} | shorts ${formatSize(totals.shorts)} | edit ${formatSize(totals.edit)}`,
  );
  console.log(
    `        ${rows.length} video(s), ${formatSize(totals.work + totals.main + totals.shorts + totals.edit)} on disk`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
