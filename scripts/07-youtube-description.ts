/**
 * Stage 7 — YouTube description generator.
 *
 * Reads the edited transcript for a video and asks Gemini to produce:
 *   - 3 title candidates (SEO + click-through aware)
 *   - A 2–3 paragraph description
 *   - Chapter list with timestamps (based on post-jetcut timeline)
 *   - Hashtags + tag list
 *
 * Output goes to `output/edit/<name>/youtube.md` so it sits next to the
 * other editor-facing sidecar files.
 *
 * Usage: npm run youtube -- input/demo.mp4
 */

import fs from "node:fs";
import path from "node:path";
import { ensureWorkspace, editExportFor } from "./lib/paths.js";
import { remapTranscript } from "./lib/timeline.js";
import { applyTranscriptEdit } from "./lib/transcript-edit.js";
import { generateYouTubeDescription } from "./lib/gemini.js";
import type { Transcript } from "./lib/whisper.js";
import type { SpeechRange } from "./lib/ffmpeg.js";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run youtube -- <input-video>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  if (!fs.existsSync(absInput)) {
    console.error(`input not found: ${absInput}`);
    process.exit(1);
  }

  const ws = ensureWorkspace(absInput);
  const out = editExportFor(absInput);

  if (!fs.existsSync(ws.transcript)) {
    console.error(
      `[youtube] transcript.json not found. Run /video-start first.`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(ws.cutPlan)) {
    console.error(
      `[youtube] cut_plan.json not found. Run /video-finish or /video-export-edit first.`,
    );
    process.exit(1);
  }

  // Load + remap transcript to post-jetcut timeline (so the chapter
  // timestamps line up with the actual jetcut.mp4 the viewer watches).
  const rawTranscript = JSON.parse(fs.readFileSync(ws.transcript, "utf8")) as Transcript;
  const editedTranscript = applyTranscriptEdit(rawTranscript, ws.transcriptEdit);
  const { ranges } = JSON.parse(fs.readFileSync(ws.cutPlan, "utf8")) as {
    ranges: SpeechRange[];
  };
  const postCutTranscript = remapTranscript(editedTranscript, ranges);

  console.log("[youtube] asking Gemini to draft YouTube description…");
  const desc = await generateYouTubeDescription(postCutTranscript);

  // Build the final markdown file
  const md = buildMarkdown(desc);

  fs.mkdirSync(out.dir, { recursive: true });
  const outFile = path.join(out.dir, "youtube.md");
  fs.writeFileSync(outFile, md);
  console.log(`[youtube] → ${outFile}`);
  console.log(
    `\n--- preview ---\n${md.slice(0, 600)}${md.length > 600 ? "\n...\n" : ""}`,
  );
}

function buildMarkdown(desc: {
  titles: string[];
  description: string;
  chapters: Array<{ timeSec: number; title: string }>;
  hashtags: string[];
  tags: string[];
}): string {
  const lines: string[] = [];

  lines.push("# YouTube 概要欄\n");

  lines.push("## タイトル案\n");
  desc.titles.forEach((t, i) => {
    lines.push(`${i + 1}. ${t}`);
  });
  lines.push("");

  lines.push("## 概要文\n");
  lines.push(desc.description.trim());
  lines.push("");

  lines.push("## 章立て（タイムスタンプ）\n");
  lines.push("```");
  for (const ch of desc.chapters) {
    lines.push(`${fmtYouTubeTime(ch.timeSec)} ${ch.title}`);
  }
  lines.push("```\n");

  lines.push("## ハッシュタグ\n");
  lines.push(desc.hashtags.join(" "));
  lines.push("");

  lines.push("## タグ（YouTube Studio 用）\n");
  lines.push(desc.tags.join(", "));
  lines.push("");

  lines.push("---\n");
  lines.push("## コピペ用（YouTube概要欄にそのまま貼り付け可能）\n");
  lines.push("```");
  lines.push(desc.description.trim());
  lines.push("");
  lines.push("■ 章立て");
  for (const ch of desc.chapters) {
    lines.push(`${fmtYouTubeTime(ch.timeSec)} ${ch.title}`);
  }
  lines.push("");
  lines.push(desc.hashtags.join(" "));
  lines.push("```\n");

  return lines.join("\n");
}

/**
 * YouTube chapter format requires at least one chapter at 0:00 and uses
 * MM:SS for videos under an hour, H:MM:SS otherwise.
 */
function fmtYouTubeTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
