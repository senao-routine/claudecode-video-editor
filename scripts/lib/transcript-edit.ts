/**
 * Human-in-the-loop transcript editing.
 *
 * Whisper makes systematic mistakes on katakana, English loanwords, and
 * domain-specific proper nouns ("Claude" → "クロード" / "クラウド" mix-ups,
 * tool names, etc.). Rather than try to auto-correct, we let the user
 * hand-edit a markdown form of the transcript before downstream stages run.
 *
 * Workflow:
 *   1. Stage 1 (preprocess) writes `work/<name>/transcript.json` (raw from
 *      Whisper) AND `work/<name>/transcript_edit.md` (human-friendly).
 *   2. The user opens the .md, fixes mistakes, saves.
 *   3. Stage 4 / 5 (main / short) call `applyTranscriptEdit()` which reads
 *      the .md and overwrites segment text on the in-memory transcript
 *      before passing it to Remotion. Timestamps are preserved.
 *
 * Word-level timestamps are NOT updated by edits — they are kept as-is from
 * the original Whisper output. They are only used for filtering during
 * highlight slicing, never displayed.
 */

import fs from "node:fs";
import type { Transcript } from "./whisper.js";

const EDIT_HEADER = `# 文字起こし編集ファイル
#
# このファイルを編集してから本編動画レンダリング (npm run main / /edit-main)
# を再実行してください。Whisper の誤認識（カタカナ語、固有名詞、英語の専門
# 用語など）を手動で修正できます。
#
# === 編集ルール ===
#   1. 角括弧 [#番号 開始-終了] は **絶対に変更しない** こと
#   2. 行を増やしたり減らしたり並べ替えたりしない こと
#   3. 角括弧の右側のテキスト（一行）だけを編集する こと
#   4. 改行は入れない（字幕の改行は config/style.json のルールで自動処理されます）
#
# 編集後、再レンダリング時に自動で transcript.json に反映されます。
# 一度編集すれば、その編集内容はキャッシュされ、入力動画を変えない限り
# 何度再レンダリングしても保たれます。
#
# ============================================================
`;

const SEGMENT_RE = /^\[#\s*(\d+)\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\]\s*(.*)$/;

/**
 * Write a transcript out as a human-editable markdown file.
 *
 * Each segment becomes one line of the form:
 *   [#  0    0.00-  2.50] こんにちはせなおです
 *
 * The leading `#0` is the segment id — it is the canonical identifier we
 * use when applying edits, so reordering or deleting lines is detected
 * and ignored gracefully.
 */
export function writeTranscriptEdit(
  transcript: Transcript,
  outFile: string,
): void {
  const lines: string[] = [EDIT_HEADER];
  for (const seg of transcript.segments) {
    const start = seg.start.toFixed(2).padStart(7, " ");
    const end = seg.end.toFixed(2).padStart(7, " ");
    const id = String(seg.id).padStart(3, " ");
    // Collapse internal newlines so the editable form is always one line
    // per segment. Wrap rules in style.json take care of subtitle layout.
    const text = seg.text.trim().replace(/\s+/g, " ");
    lines.push(`[#${id} ${start}-${end}] ${text}`);
  }
  fs.writeFileSync(outFile, lines.join("\n") + "\n");
}

/**
 * Parse an edit file back into a `segmentId → text` map.
 *
 * Lines that don't match the expected format are silently ignored, so the
 * user can leave comments or blank lines without breaking parsing.
 */
export function parseTranscriptEdit(file: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!fs.existsSync(file)) return map;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(SEGMENT_RE);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    const text = m[4].trim();
    map.set(id, text);
  }
  return map;
}

/**
 * Return a new transcript with segment texts overwritten by any edits
 * found in the .md file. If the file does not exist or contains no
 * recognized edits, returns the input transcript unchanged.
 *
 * Reports how many segments were modified to the console.
 */
export function applyTranscriptEdit(
  transcript: Transcript,
  editFile: string,
): Transcript {
  if (!fs.existsSync(editFile)) return transcript;
  const edits = parseTranscriptEdit(editFile);
  if (edits.size === 0) return transcript;

  let changed = 0;
  const segments = transcript.segments.map((s) => {
    const edited = edits.get(s.id);
    if (edited === undefined) return s;
    if (edited === s.text.trim().replace(/\s+/g, " ")) return s;
    changed++;
    return { ...s, text: edited };
  });

  if (changed > 0) {
    console.log(
      `[transcript-edit] applied ${changed} manual edits from ${editFile}`,
    );
  }
  return { ...transcript, segments };
}
