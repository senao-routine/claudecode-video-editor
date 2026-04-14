import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, "..", "..");
export const INPUT_DIR = path.join(ROOT, "input");
export const WORK_DIR = path.join(ROOT, "work");
export const OUTPUT_DIR = path.join(ROOT, "output");
export const OUTPUT_MAIN_DIR = path.join(OUTPUT_DIR, "main");
export const OUTPUT_SHORTS_DIR = path.join(OUTPUT_DIR, "shorts");
export const OUTPUT_EDIT_DIR = path.join(OUTPUT_DIR, "edit");
export const REMOTION_ENTRY = path.join(ROOT, "remotion", "src", "index.ts");

/**
 * Per-video working directory layout.
 *
 * For an input file like `input/demo.mp4`, everything generated for it lives
 * under `work/demo/` so re-running on a different video never clobbers state.
 */
export function workspaceFor(inputVideo: string) {
  const base = path.basename(inputVideo, path.extname(inputVideo));
  const dir = path.join(WORK_DIR, base);
  return {
    base,
    dir,
    audio: path.join(dir, "audio.wav"),
    audioNormalized: path.join(dir, "audio_normalized.wav"),
    silences: path.join(dir, "silences.json"),
    transcript: path.join(dir, "transcript.json"),
    transcriptEdit: path.join(dir, "transcript_edit.md"),
    cutPlan: path.join(dir, "cut_plan.json"),
    jetcut: path.join(dir, "jetcut.mp4"),
    brollPlan: path.join(dir, "broll_plan.json"),
    brollDir: path.join(dir, "broll"),
    subtitlesAss: path.join(dir, "subtitles.ass"),
    subtitlesSrt: path.join(dir, "subtitles.srt"),
    highlights: path.join(dir, "highlights.json"),
  };
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureWorkspace(inputVideo: string) {
  const ws = workspaceFor(inputVideo);
  ensureDir(ws.dir);
  ensureDir(ws.brollDir);
  ensureDir(OUTPUT_MAIN_DIR);
  ensureDir(OUTPUT_SHORTS_DIR);
  ensureDir(OUTPUT_EDIT_DIR);
  return ws;
}

/**
 * Per-video edit-export bundle layout. Used by `06-export-edit.ts` to write
 * a single self-contained directory of editor-friendly intermediates.
 */
export function editExportFor(inputVideo: string) {
  const base = path.basename(inputVideo, path.extname(inputVideo));
  const dir = path.join(OUTPUT_EDIT_DIR, base);
  return {
    base,
    dir,
    jetcut: path.join(dir, "jetcut.mp4"),
    srt: path.join(dir, "subtitles.srt"),
    ass: path.join(dir, "subtitles.ass"),
    fcpxml: path.join(dir, "timeline.xml"),
    edl: path.join(dir, "timeline.edl"),
    markersCsv: path.join(dir, "markers.csv"),
    markersJson: path.join(dir, "markers.json"),
    brollDir: path.join(dir, "broll"),
    readme: path.join(dir, "README.md"),
  };
}
