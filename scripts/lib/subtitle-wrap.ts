/**
 * Japanese subtitle line-wrapping.
 *
 * Rules (from CLAUDE.md / project style guide):
 *  1. Wrap at clause boundaries (after particles like は/が/を/に/で/と/も)
 *  2. Never split a subject from its predicate or a modifier from what it modifies
 *  3. 1 line targets 13–16 full-width characters; max 2 lines
 *  4. Never split a compound noun (機械学習) or proper noun mid-word
 *  5. Prefer breaking at 読点「、」 if present
 *  6. The line that comes AFTER a break must not start with a particle
 *
 * Strategy: rule-based, no morphological analyzer.
 *  - Score every character index by how good a break it would be
 *  - Pick the highest-scoring index closest to the target line length
 *  - Recurse on the remainder up to maxLines
 *
 * This is a heuristic, not a parser. It does the right thing on the
 * common cases (sentence with one or two clauses + a 読点) and degrades
 * gracefully (will simply hard-wrap if no good break is found).
 */

export interface WrapConfig {
  minCharsPerLine: number;
  maxCharsPerLine: number;
  maxLines: number;
  preferComma: boolean;
  noLeadingParticle: boolean;
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
  "から",
  "まで",
  "より",
  "ね",
  "よ",
  "か",
  "わ",
]);

// Multi-character particles. Order matters (longest first).
const MULTI_PARTICLES = ["から", "まで", "より", "には", "では", "とは"];

const COMMAS = new Set(["、", ","]);
const PERIODS = new Set(["。", "．", "！", "？", "?", "!"]);

// Characters that should never start a new line (kinsoku shori).
const NO_LINE_START = new Set([
  "、",
  "。",
  "，",
  "．",
  "！",
  "？",
  "!",
  "?",
  "）",
  "）",
  "」",
  "』",
  "}",
  "]",
  "ー",
  "ゝ",
  "ゞ",
  "々",
  "ヽ",
  "ヾ",
]);

/**
 * Score how desirable it is to break a line AFTER position `i` (i.e.,
 * the next line starts at i+1). Higher = better. Negative = forbidden.
 */
function scoreBreakAfter(text: string, i: number, cfg: WrapConfig): number {
  const here = text[i];
  const next = text[i + 1];

  // Forbidden: would put a no-line-start character at the start of the next line
  if (next && NO_LINE_START.has(next)) return -1;

  // Forbidden: next line starts with a particle
  if (cfg.noLeadingParticle && next && PARTICLES.has(next)) return -1;
  if (cfg.noLeadingParticle && next) {
    const nextTwo = text.slice(i + 1, i + 3);
    for (const p of MULTI_PARTICLES) {
      if (nextTwo.startsWith(p)) return -1;
    }
  }

  let score = 1;

  // Best: right after a 読点
  if (COMMAS.has(here)) score += 100;

  // Very good: right after a sentence-ending punctuation
  if (PERIODS.has(here)) score += 80;

  // Good: right after a particle (single char)
  if (PARTICLES.has(here)) score += 40;

  // Good: right after a multi-char particle (check the trailing chars)
  for (const p of MULTI_PARTICLES) {
    if (text.slice(i - p.length + 1, i + 1) === p) {
      score += 50;
      break;
    }
  }

  // Slight bonus: kana → kanji or kanji → kana transitions are often
  // morpheme boundaries. Detect with simple Unicode range checks.
  if (here && next) {
    const hereKind = charKind(here);
    const nextKind = charKind(next);
    if (hereKind !== nextKind && hereKind !== "other" && nextKind !== "other") {
      score += 5;
    }
  }

  return score;
}

function charKind(c: string): "hira" | "kata" | "kanji" | "ascii" | "other" {
  const code = c.codePointAt(0) ?? 0;
  if (code >= 0x3040 && code <= 0x309f) return "hira";
  if (code >= 0x30a0 && code <= 0x30ff) return "kata";
  if (code >= 0x4e00 && code <= 0x9fff) return "kanji";
  if (code >= 0x21 && code <= 0x7e) return "ascii";
  return "other";
}

/**
 * Try to find the best break index in `text` so that the first piece is
 * roughly within [min, max] characters. Returns -1 if nothing acceptable.
 */
function findBestBreak(text: string, cfg: WrapConfig): number {
  if (text.length <= cfg.maxCharsPerLine) return -1; // no break needed

  // Search window: prefer indices in [min, max], expand if nothing found
  const start = Math.max(1, cfg.minCharsPerLine - 1);
  const end = Math.min(text.length - 1, cfg.maxCharsPerLine);

  let bestIdx = -1;
  let bestScore = -1;

  // First pass: search the preferred window
  for (let i = start; i <= end; i++) {
    const s = scoreBreakAfter(text, i, cfg);
    // Prefer indices closer to the middle of the window for visual balance
    const center = (start + end) / 2;
    const balance = Math.max(0, 10 - Math.abs(i - center));
    const totalScore = s + balance * 0.1;
    if (s >= 0 && totalScore > bestScore) {
      bestScore = totalScore;
      bestIdx = i;
    }
  }

  // If nothing decent in the preferred window, expand backwards a bit
  if (bestIdx === -1 || bestScore < 1) {
    const fallbackStart = Math.max(1, Math.floor(cfg.minCharsPerLine / 2));
    const fallbackEnd = Math.min(text.length - 1, cfg.maxCharsPerLine + 4);
    for (let i = fallbackStart; i <= fallbackEnd; i++) {
      const s = scoreBreakAfter(text, i, cfg);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
  }

  return bestIdx;
}

/**
 * Wrap a single line of Japanese text into up to `maxLines` lines per the
 * project's wrap config. Returns lines joined by '\n'.
 */
export function wrapJapaneseSubtitle(text: string, cfg: WrapConfig): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= cfg.maxCharsPerLine) return trimmed;

  const lines: string[] = [];
  let remaining = trimmed;

  for (let lineNo = 0; lineNo < cfg.maxLines - 1; lineNo++) {
    if (remaining.length <= cfg.maxCharsPerLine) break;
    const breakIdx = findBestBreak(remaining, cfg);
    if (breakIdx === -1) break;
    lines.push(remaining.slice(0, breakIdx + 1).trim());
    remaining = remaining.slice(breakIdx + 1).trim();
  }
  lines.push(remaining);

  // If the last line is still over the limit and we have room for more
  // lines, the rules say "max 2 lines". We accept the overflow rather
  // than introducing a 3rd line — the renderer will shrink-to-fit if
  // configured to do so.
  return lines.join("\n");
}
