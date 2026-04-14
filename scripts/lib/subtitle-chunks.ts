/**
 * Japanese subtitle chunking.
 *
 * Instead of squeezing an entire long sentence into a single subtitle frame
 * (which would require shrinking the font), this module splits each Whisper
 * segment into short, readable chunks (typically 2–8 characters each) that
 * flip in sequence over the duration of the original segment. This keeps the
 * on-screen font size constant regardless of how long the speaker's sentence
 * is, which is much easier to read.
 *
 * Example:
 *   "私は昨日新しいパソコンを買いました"
 *   → ["私は", "昨日新しい", "パソコンを", "買いました"]
 *
 * Strategy: rule-based, no morphological analyzer.
 *
 *   1. Group consecutive characters of the same character class
 *      (kanji / hiragana / katakana / ASCII / digits) into raw groups.
 *   2. Attach trailing single-character particles (は/が/を/に/で/と/も…)
 *      and punctuation (、。!?) to the previous group.
 *   3. Merge tiny groups (< minChars) with a neighbor:
 *      - A bare kanji root followed by a hiragana inflection → merge
 *        forward ("買" + "いました" → "買いました")
 *      - A short hiragana inflection (≤ 2 chars) following a kanji
 *        group → merge backward ("昨日新" + "しい" → "昨日新しい")
 *      - Otherwise merge backward into the previous chunk.
 *
 * Then assign timing proportionally to character count within the original
 * segment's [start, end] window.
 */

import type { Transcript, TranscriptSegment } from "./whisper.js";

export interface ChunkingConfig {
  /** Chunks shorter than this many characters are merged into a neighbor. */
  minChars: number;
  /** Soft target — chunks beyond this are still emitted, but rarely happen with rule-based splitting. */
  maxChars: number;
  /** Minimum on-screen time per chunk (seconds). Chunks that would be shorter than this are extended at the cost of the next one. */
  minDurationSec: number;
}

const PARTICLES = new Set([
  "は",
  "が",
  "を",
  "に",
  "へ",
  "で",
  "と",
  "も",
  "の",
  "や",
  "ね",
  "よ",
  "か",
  "わ",
]);

const PUNCT = new Set(["、", "。", "．", "，", "！", "？", "!", "?"]);

type CharKind = "kanji" | "hira" | "kata" | "ascii" | "digit" | "other";

function charKind(c: string): CharKind {
  const code = c.codePointAt(0) ?? 0;
  if (code >= 0x3040 && code <= 0x309f) return "hira";
  if (code >= 0x30a0 && code <= 0x30ff) return "kata";
  if (code >= 0x4e00 && code <= 0x9fff) return "kanji";
  if (code >= 0x30 && code <= 0x39) return "digit";
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return "ascii";
  return "other";
}

function isAllOf(s: string, kind: CharKind): boolean {
  for (const c of s) if (charKind(c) !== kind) return false;
  return true;
}

function endsWith(s: string, kind: CharKind): boolean {
  if (s.length === 0) return false;
  return charKind(s[s.length - 1]) === kind;
}

function startsWith(s: string, kind: CharKind): boolean {
  if (s.length === 0) return false;
  return charKind(s[0]) === kind;
}

/**
 * Split a single segment of Japanese text into a list of readable chunks.
 */
export function splitIntoChunks(text: string, cfg: ChunkingConfig): string[] {
  const normalized = text.replace(/\s+/g, "").trim();
  if (!normalized) return [];

  // ---- Step 1: group consecutive same-class characters ----
  const groups: string[] = [];
  let current = "";
  let prevKind: CharKind | null = null;
  for (const c of normalized) {
    const kind = charKind(c);
    if (prevKind === null || kind === prevKind) {
      current += c;
    } else {
      groups.push(current);
      current = c;
    }
    prevKind = kind;
  }
  if (current) groups.push(current);

  // ---- Step 2: attach trailing particles / punctuation to the previous group ----
  // A standalone single-char hiragana group that is a particle (は/が/を…)
  // belongs to the previous noun phrase, not on its own.
  const merged: string[] = [];
  for (const g of groups) {
    const isParticle = g.length === 1 && PARTICLES.has(g);
    const isPunct = g.length === 1 && PUNCT.has(g);
    if ((isParticle || isPunct) && merged.length > 0) {
      merged[merged.length - 1] += g;
    } else {
      merged.push(g);
    }
  }

  // ---- Step 3: glue together morphological fragments ----
  // This step produces "phrase units" — small groupings like "私は",
  // "昨日新しい", "買いました". They are NOT yet at the configured
  // min/max chars; that final sizing happens in Step 5 below.
  const phrases: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    let g = merged[i];
    const next = merged[i + 1];

    if (phrases.length === 0) {
      phrases.push(g);
      continue;
    }

    const last = phrases[phrases.length - 1];

    // Bare kanji root + hiragana inflection → merge forward
    // ("買" + "いました" → "買いました")
    if (
      g.length <= 2 &&
      isAllOf(g, "kanji") &&
      next &&
      startsWith(next, "hira")
    ) {
      merged[i + 1] = g + next;
      continue;
    }

    // Short hiragana inflection following a kanji-ending chunk → merge backward
    // ("昨日新" + "しい" → "昨日新しい")
    if (
      g.length <= 2 &&
      isAllOf(g, "hira") &&
      endsWith(last, "kanji")
    ) {
      phrases[phrases.length - 1] = last + g;
      continue;
    }

    // Tiny standalone fragment (1 char) → glue to previous so we never
    // emit single-character phrase units.
    if (g.length === 1) {
      phrases[phrases.length - 1] = last + g;
      continue;
    }

    phrases.push(g);
  }

  // ---- Step 4: pack phrase units into target-sized chunks ----
  // Walk through the phrase units, prefer to flush whenever we are inside
  // [minChars, maxChars]. Soft-prefers chunks closer to the middle of the
  // window for visual balance, but always respects phrase boundaries.
  const final = packPhrases(phrases, cfg);

  // ---- Step 5: enforce maxChars by splitting overly-long runs ----
  // Long hiragana-only runs (e.g. "はいどうもこんにちはせなおです") cannot
  // be split by character-class boundaries, so we fall back to a fixed
  // maxChars-wide cut here. Rare for typical sentences after Step 3.
  //
  // ASCII / digit runs (proper nouns like "NanoBanana2", "MagicLayers")
  // are EXEMPT — splitting them mid-word would be wrong even if they
  // exceed maxChars.
  const splitLong: string[] = [];
  for (const g of final) {
    if (g.length <= cfg.maxChars || isProperNounRun(g)) {
      splitLong.push(g);
      continue;
    }
    for (let i = 0; i < g.length; i += cfg.maxChars) {
      splitLong.push(g.slice(i, i + cfg.maxChars));
    }
    // If the very last sub-chunk is too short, merge it back into its
    // predecessor so we don't strand a 1-character orphan.
    if (
      splitLong.length >= 2 &&
      splitLong[splitLong.length - 1].length < cfg.minChars
    ) {
      const tail = splitLong.pop() as string;
      splitLong[splitLong.length - 1] += tail;
    }
  }

  return splitLong;
}

/**
 * Pack phrase units into chunks respecting [minChars, maxChars] using a
 * dynamic programming optimizer.
 *
 * Goal: partition the phrase array into a sequence of contiguous groups
 * where each group's joined length is ideally inside [minChars, maxChars],
 * the partition never breaks a phrase mid-word, and the total layout cost
 * is minimized.
 *
 * Cost per chunk:
 *   - 0 if the chunk length is inside [minChars, maxChars]
 *   - quadratic penalty for under-min (the further below, the worse)
 *   - very high penalty for over-max (we hard-cap by skipping such states)
 *
 * Cost is summed across all chunks. Ties are broken by preferring chunks
 * closer to the middle of the window (i.e. chunks of length ≈ (min+max)/2).
 */
function packPhrases(phrases: string[], cfg: ChunkingConfig): string[] {
  if (phrases.length === 0) return [];

  // Trivial case: the whole input fits in one chunk.
  const total = phrases.reduce((s, p) => s + p.length, 0);
  if (total <= cfg.maxChars) {
    return [phrases.join("")];
  }

  const n = phrases.length;
  const target = (cfg.minChars + cfg.maxChars) / 2;

  // chunkCost[i][j] = cost of grouping phrases[i..j-1] into one chunk
  // (Infinity if it would exceed maxChars).
  const chunkLen: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i < n; i++) {
    let len = 0;
    for (let j = i + 1; j <= n; j++) {
      len += phrases[j - 1].length;
      chunkLen[i][j] = len;
    }
  }

  function chunkCost(len: number): number {
    if (len > cfg.maxChars) return Number.POSITIVE_INFINITY;
    if (len >= cfg.minChars) {
      // Inside the window — tiny penalty for being far from the middle
      return Math.pow(len - target, 2) * 0.01;
    }
    // Below minChars — heavy penalty so the optimizer prefers fewer
    // under-min chunks even if it means slightly imbalanced sizes elsewhere.
    // The penalty grows fast with how far below min we are.
    return Math.pow(cfg.minChars - len, 2) * 5 + 50;
  }

  // DP: best[i] = minimum total cost for partitioning phrases[0..i-1]
  const best: number[] = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
  const cut: number[] = new Array(n + 1).fill(-1);
  best[0] = 0;

  for (let j = 1; j <= n; j++) {
    for (let i = 0; i < j; i++) {
      const len = chunkLen[i][j];
      if (len > cfg.maxChars) continue; // hard constraint
      const candidate = best[i] + chunkCost(len);
      if (candidate < best[j]) {
        best[j] = candidate;
        cut[j] = i;
      }
    }
  }

  // Reconstruct the partition by walking backward from n.
  const out: string[] = [];
  let j = n;
  while (j > 0) {
    const i = cut[j];
    if (i < 0) {
      // Should never happen because the trivial case is handled above and
      // each phrase fits within maxChars individually (Step 5 enforces it).
      // Fall back to a single greedy cut.
      out.unshift(phrases.slice(0, j).join(""));
      break;
    }
    out.unshift(phrases.slice(i, j).join(""));
    j = i;
  }
  return out;
}

/**
 * A "proper noun run" is a chunk made entirely of ASCII letters, digits,
 * and the connector characters that often appear inside product names
 * (NanoBanana2, MagicLayers, gpt-4o, etc.). We never split these mid-word.
 */
function isProperNounRun(s: string): boolean {
  for (const c of s) {
    const k = charKind(c);
    if (k !== "ascii" && k !== "digit") return false;
  }
  return s.length > 0;
}

/**
 * Split a single segment into chunks AND assign timing within the
 * segment's [start, end] window. Timing is proportional to character count.
 */
export function chunkSegmentWithTiming(
  seg: TranscriptSegment,
  cfg: ChunkingConfig,
): TranscriptSegment[] {
  const chunks = splitIntoChunks(seg.text, cfg);
  if (chunks.length === 0) return [];
  if (chunks.length === 1) return [{ ...seg, text: chunks[0] }];

  const totalChars = chunks.reduce((s, c) => s + c.length, 0);
  const duration = seg.end - seg.start;
  const minDuration = cfg.minDurationSec;

  // First pass: proportional split
  const raw: { text: string; duration: number }[] = chunks.map((c) => ({
    text: c,
    duration: duration * (c.length / totalChars),
  }));

  // Second pass: enforce minDuration by stealing from the next chunk
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i].duration < minDuration) {
      const need = minDuration - raw[i].duration;
      raw[i].duration += need;
      raw[i + 1].duration = Math.max(0.05, raw[i + 1].duration - need);
    }
  }

  // Build the absolute-time segments, snapping the last one to seg.end
  // so we never drift past the original Whisper window.
  const result: TranscriptSegment[] = [];
  let cursor = seg.start;
  for (let i = 0; i < raw.length; i++) {
    const isLast = i === raw.length - 1;
    const start = cursor;
    const end = isLast ? seg.end : Math.min(seg.end, cursor + raw[i].duration);
    result.push({
      id: 0, // re-numbered globally by chunkTranscript()
      start,
      end,
      text: raw[i].text,
    });
    cursor = end;
  }
  return result;
}

/**
 * Apply chunking to every segment in a transcript and return a new
 * transcript whose segments are the small, readable chunks.
 *
 * Word-level timestamps are passed through unchanged — they are only used
 * for highlight slicing, never for display.
 */
export function chunkTranscript(
  transcript: Transcript,
  cfg: ChunkingConfig,
): Transcript {
  const allSegments: TranscriptSegment[] = [];
  for (const seg of transcript.segments) {
    const chunks = chunkSegmentWithTiming(seg, cfg);
    for (const c of chunks) {
      allSegments.push({ ...c, id: allSegments.length });
    }
  }
  return { ...transcript, segments: allSegments };
}
