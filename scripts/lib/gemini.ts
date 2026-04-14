import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import { config } from "./config.js";
import { loadStyle } from "./style.js";
import { verifyGeneratedImage, type VerificationResult } from "./vision-verify.js";
import { generateImageViaRenoise } from "./renoise-image.js";
import type { Transcript } from "./whisper.js";

/**
 * A Gemini-planned B-roll moment in the transcript.
 *
 * `startSec`/`endSec` are seconds on the ORIGINAL (pre-jetcut) timeline.
 * The B-roll pipeline remaps these to the post-jetcut timeline later.
 *
 * `displayMode` controls how the clip appears in the final composition:
 *   - "pip"        — small picture-in-picture overlay in a corner
 *   - "fullscreen" — replaces the screen recording for the whole clip
 *
 * Use "fullscreen" for important / dramatic / on-topic visuals that should
 * grab the viewer's full attention. Use "pip" for supporting illustrations
 * that complement what the presenter is showing on screen.
 */
export interface BRollMoment {
  startSec: number;
  endSec: number;
  topic: string;
  imagePrompt: string;
  videoPrompt: string;
  kind: "image" | "video";
  displayMode: "pip" | "fullscreen";
}

export interface Highlight {
  startSec: number;
  endSec: number;
  title: string;
  hookText: string;
  reason: string;
}

function gemini() {
  return new GoogleGenerativeAI(config.gemini.apiKey);
}

/**
 * Ask Gemini to pick 3–8 moments in the transcript where B-roll would add
 * value, decide pip vs fullscreen, and write generation prompts that
 * follow the project's style guide.
 */
export async function planBRoll(transcript: Transcript): Promise<BRollMoment[]> {
  const style = loadStyle();
  const model = gemini().getGenerativeModel({
    model: config.gemini.model,
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `You are an editor for an AI/IT explainer YouTube channel in Japanese. The transcript below is from a screen recording where the presenter walks through a tool or concept. Identify 3 to 8 moments where inserting B-roll (a supporting image or short video clip) would make the explanation clearer or more engaging.

Rules for choosing moments:
- Prefer moments where the presenter introduces a concept that is abstract, historical, or NOT visible on their screen.
- Avoid moments where the screen capture is already showing exactly what is being described.
- Avoid the very first 3 seconds (intro) and the last 3 seconds (outro).
- Each moment should be 4–10 seconds long.

Rules for kind ("image" vs "video"):
- "image" — fast, cheap, good for static concepts, diagrams, reference visuals.
- "video" — animated motion graphics, dynamic shots. Use sparingly (it is expensive).

Rules for displayMode ("pip" vs "fullscreen"):
- "fullscreen" — the B-roll fully replaces the screen recording. Use this when the B-roll is HIGHLY relevant and visually self-explanatory (a strong on-topic motion graphic, a dramatic reveal, a key supporting illustration). Default to fullscreen for "video" kind.
- "pip" — small picture-in-picture overlay. Use this when the screen recording is itself important and the B-roll is a small supporting visual (icon, reference figure).

Rules for prompts (CRITICAL):
- imagePrompt and videoPrompt must be in ENGLISH (the generative models expect English).
- BUT any text that should appear inside the generated artwork itself MUST be specified as Japanese text (in the prompt, write it in Japanese inside quotes, e.g. \`include the Japanese title "生成AIの活用法"\`).
- Never instruct the model to include English-language text in the artwork.
- Follow this style guide for visual identity (it is appended to every generation request, so you don't need to repeat it verbatim — but stay consistent with it):
"""
${style.generation.imageStyleGuide}
"""

Return strictly this JSON schema (no extra fields):
{"moments": [{"startSec": number, "endSec": number, "topic": string, "imagePrompt": string, "videoPrompt": string, "kind": "image" | "video", "displayMode": "pip" | "fullscreen"}]}

Transcript (segments with timestamps in seconds):
${transcript.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`).join("\n")}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text) as { moments: BRollMoment[] };
  // Defensive: fill in displayMode if Gemini omits it
  for (const m of parsed.moments) {
    if (m.displayMode !== "pip" && m.displayMode !== "fullscreen") {
      m.displayMode = style.broll.defaultMode;
    }
  }
  return parsed.moments;
}

/**
 * Ask Gemini to pick 1–3 highlight windows suitable for a 30–60 second
 * vertical short.
 */
export async function planHighlights(transcript: Transcript, count = 2): Promise<Highlight[]> {
  const model = gemini().getGenerativeModel({
    model: config.gemini.model,
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `You are a short-form video editor for an AI/IT channel. Pick ${count} self-contained highlight windows from the transcript below that would each make a great 30–60 second vertical short for TikTok / YouTube Shorts / Instagram Reels.

Rules:
- Each highlight must be between 25 and 60 seconds long.
- Each highlight must START on a complete thought (not mid-sentence).
- Prefer moments with a clear hook ("ここで驚いたのが…", "実はこの機能で…", tool reveals, surprising results, punchlines).
- Provide a catchy Japanese title (<= 24 chars) and a one-line hook (<= 40 chars).
- Return strictly this JSON schema:
{"highlights": [{"startSec": number, "endSec": number, "title": string, "hookText": string, "reason": string}]}

Transcript (segments with timestamps in seconds):
${transcript.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`).join("\n")}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text) as { highlights: Highlight[] };
  return parsed.highlights;
}

/**
 * Generate a B-roll still image with a multi-stage quality pipeline:
 *
 *   1. Start with the user's primary model (`generation.imagePrimaryModel`
 *      in config/style.json, default: Gemini).
 *   2. Use an attempt-specific prompt that gets progressively stricter
 *      about text rendering — by attempt 2 we ask for NO text at all.
 *   3. After each generation, if verification is enabled, feed the image
 *      into Gemini Vision and check for English text / broken Japanese.
 *   4. If verification fails, retry (up to maxAttempts).
 *   5. If all Gemini attempts fail verification, fall back to the
 *      configured fallback model (default: Renoise nano-banana-2), which
 *      has different failure modes and often succeeds where Gemini fails.
 *   6. If even the fallback fails, accept the last generated image but
 *      log a warning.
 *
 * This replaces the old "hope the next generation is better" retry loop
 * with an actual quality gate. The verification call costs ~1/400th of
 * the image generation itself so it's effectively free.
 */
export async function generateImage(
  prompt: string,
  outFile: string,
  opts: { maxAttempts?: number } = {},
): Promise<void> {
  const style = loadStyle();
  const maxAttempts = Math.max(1, opts.maxAttempts ?? style.generation.imageMaxAttempts);
  const primary = style.generation.imagePrimaryModel;
  const fallback = style.generation.imageFallbackModel;
  const shouldVerify = style.generation.imageVerify;

  // Build the backend call order: primary first, then fallback (if any).
  // We split the attempt budget between them, giving the primary two
  // attempts and the fallback the remaining budget.
  const plan: Array<{ backend: "gemini" | "renoise"; attempt: number }> = [];
  const primaryAttempts = fallback === "none" ? maxAttempts : Math.max(1, maxAttempts - 1);
  for (let i = 1; i <= primaryAttempts; i++) {
    plan.push({ backend: primary, attempt: i });
  }
  if (fallback !== "none") {
    const fallbackAttempts = Math.max(1, maxAttempts - primaryAttempts);
    for (let i = 1; i <= fallbackAttempts; i++) {
      plan.push({ backend: fallback, attempt: i });
    }
  }

  let lastError: unknown = null;
  let lastVerification: VerificationResult | null = null;
  let imageGenerated = false;

  for (let step = 0; step < plan.length; step++) {
    const { backend, attempt } = plan[step];
    const isLastStep = step === plan.length - 1;
    const label = `${backend}#${attempt}`;

    // 1. Generate
    try {
      const promptForAttempt = buildImagePrompt(prompt, style, attempt);
      if (backend === "gemini") {
        await generateImageViaGemini(promptForAttempt, outFile);
      } else {
        await generateImageViaRenoise(promptForAttempt, outFile, {
          aspectRatio: style.generation.imageAspectRatio,
          resolution: style.generation.imageResolution,
        });
      }
      imageGenerated = true;
    } catch (e) {
      lastError = e;
      console.warn(`[image] ${label} generation failed: ${(e as Error).message}`);
      continue;
    }

    // 2. Verify (optional)
    if (!shouldVerify) {
      console.log(`[image] ${label} accepted (verification disabled)`);
      return;
    }

    try {
      const verification = await verifyGeneratedImage(outFile);
      lastVerification = verification;
      const passed = !verification.hasEnglishText && !verification.hasBrokenJapanese;

      if (passed) {
        console.log(
          `[image] ${label} passed verification: ${verification.description}`,
        );
        return;
      }

      console.warn(
        `[image] ${label} rejected — english=${verification.hasEnglishText}, broken=${verification.hasBrokenJapanese}, desc="${verification.description}"`,
      );

      // Accept the last attempt even if it failed verification, but warn
      if (isLastStep) {
        console.warn(
          `[image] accepting last attempt despite verification failure (budget exhausted)`,
        );
        return;
      }
    } catch (e) {
      // Verification itself failed (e.g. network). Accept the image to
      // avoid wasting budget on a flaky verifier.
      console.warn(
        `[image] ${label} verification errored, accepting image: ${(e as Error).message}`,
      );
      return;
    }
  }

  if (!imageGenerated) {
    throw new Error(
      `All image generation attempts failed for prompt: ${prompt}. Last error: ${lastError}`,
    );
  }
  // Should not reach here — the loop returns on success or exhausts budget.
  console.warn(
    `[image] fell through plan without explicit return (last verification: ${JSON.stringify(lastVerification)})`,
  );
}

/**
 * Raw Gemini image call — no retries, no verification. Called by the
 * orchestrator in `generateImage` once per attempt.
 *
 * The model id comes from `config/style.json` (`generation.imageGeminiModelId`)
 * so the user can switch between Nano Banana generations without touching code.
 */
async function generateImageViaGemini(prompt: string, outFile: string): Promise<void> {
  const style = loadStyle();
  const model = gemini().getGenerativeModel({ model: style.generation.imageGeminiModelId });
  const result = await model.generateContent(prompt);
  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data: string; mimeType: string } })
      .inlineData;
    if (inline?.data) {
      fs.writeFileSync(outFile, Buffer.from(inline.data, "base64"));
      return;
    }
  }
  throw new Error("Gemini returned no inline image in response");
}

/**
 * Build the full Gemini image prompt for a given attempt. The first attempt
 * is firm but polite; later attempts get progressively more emphatic about
 * the "Japanese text only, never English" rule, since that's the most
 * common failure mode.
 */
function buildImagePrompt(
  basePrompt: string,
  style: ReturnType<typeof loadStyle>,
  attempt: number,
): string {
  const lines = [
    basePrompt,
    "",
    "=== STYLE GUIDE (MUST FOLLOW) ===",
    style.generation.imageStyleGuide,
    "",
    `=== NEGATIVE (avoid at all costs) ===`,
    style.generation.imageNegative,
    "",
    "=== JAPANESE LANGUAGE REQUIREMENT ===",
    "This image is for a Japanese-language YouTube explainer channel. Any text that appears inside the image MUST be written in natural Japanese using Hiragana, Katakana, and/or Kanji. Never use English alphabet letters inside the image. Never use romaji. Never use made-up or garbled characters. If you cannot write the text in correct, idiomatic Japanese, render the image WITHOUT any text at all. A clean image with no text is strongly preferred over an image with broken or English text.",
  ];

  if (attempt >= 2) {
    lines.push("");
    lines.push(
      "=== RETRY ENFORCEMENT (attempt " + attempt + ") ===",
    );
    lines.push(
      "CRITICAL: The previous attempt may have contained English or unreadable text. This time, if you are not 100% confident you can render Japanese characters correctly, DO NOT INCLUDE ANY TEXT in the image. Produce a pure visual illustration with zero text overlays, zero labels, zero captions. A clean wordless illustration is the preferred fallback.",
    );
  }
  if (attempt >= 3) {
    lines.push("");
    lines.push(
      "=== FINAL ATTEMPT ===",
    );
    lines.push(
      "Do not include any written words of any kind in this image. No Japanese text, no English text, no symbols that look like writing. Only illustrations, icons, shapes, and figures. This is a hard constraint — ignore any part of the base prompt that asks for text.",
    );
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// YouTube description
// ─────────────────────────────────────────────────────────────────────

export interface YouTubeDescription {
  titles: string[];
  description: string;
  chapters: Array<{ timeSec: number; title: string }>;
  hashtags: string[];
  tags: string[];
}

/**
 * Generate a complete YouTube description package (titles, body, chapters,
 * hashtags, tags) from a post-jetcut transcript.
 *
 * The transcript's timestamps MUST already be on the post-jetcut timeline
 * so the chapter timestamps line up with the final video the viewer sees.
 *
 * Targets a Japanese-language AI/IT explainer channel.
 */
export async function generateYouTubeDescription(
  transcript: Transcript,
): Promise<YouTubeDescription> {
  const model = gemini().getGenerativeModel({
    model: config.gemini.model,
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `あなたは日本の AI/IT 解説系 YouTube チャンネルの動画編集担当です。以下は動画の文字起こしです（タイムスタンプは編集後の動画のタイムラインに基づく秒数）。この動画の YouTube 概要欄を作成してください。

# 守るべきルール

1. **タイトル案** は3つ作成する
   - それぞれ全角30文字以内
   - クリック率を意識しつつ、釣りではなく中身を正確に伝える
   - AI/IT 系の視聴者が検索しそうなキーワードを含める
   - 1つは具体的、1つはベネフィット訴求、1つは疑問形・驚き系など、アプローチを変える

2. **概要文** は自然な日本語で2〜3段落（合計200〜400文字程度）
   - 1段落目：動画の主旨と視聴メリット
   - 2段落目：扱う機能・ツールの簡単な説明
   - 3段落目：視聴者への呼びかけ（任意）
   - 顔文字・過剰な絵文字は使わない
   - 事実と異なる内容や文字起こしにない情報を付け加えない

3. **章立て (chapters)** はYouTubeのチャプター機能用
   - **必ず 0 秒（0:00）から始まる**（YouTubeの仕様）
   - 4〜8章程度に分ける
   - 各章タイトルは全角20文字以内、内容を的確に表現
   - 章の区切りは話題の切れ目に合わせる
   - timeSec は整数秒（例: 0, 45, 120, ...）

4. **ハッシュタグ** は3〜6個
   - #AI #生成AI #Canva のように # 始まり
   - 日本語タグを中心に、一部英語可（#AI #ChatGPT など定着したもの）

5. **タグ (YouTube Studio の「タグ」欄用)** は10〜15個
   - カンマ区切りを想定、# は付けない
   - 検索流入を狙った具体的キーワード（例: "Canva 新機能", "Magic Layers", "画像生成AI 編集"）
   - 日本語 + 英語を混ぜる

# 出力形式

以下の JSON スキーマで厳密に返してください（余計な説明なし）:
{
  "titles": ["タイトル1", "タイトル2", "タイトル3"],
  "description": "概要文（改行は \\n）",
  "chapters": [
    { "timeSec": 0, "title": "オープニング" },
    { "timeSec": 45, "title": "..." }
  ],
  "hashtags": ["#AI", "#生成AI", "..."],
  "tags": ["Canva", "Magic Layers", "..."]
}

# 文字起こし

${transcript.segments
  .map((s) => `[${s.start.toFixed(1)}s] ${s.text.trim()}`)
  .join("\n")}
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text) as YouTubeDescription;

  // Defensive: ensure chapter 0 exists at 0 seconds
  if (parsed.chapters.length === 0 || parsed.chapters[0].timeSec > 0) {
    parsed.chapters.unshift({ timeSec: 0, title: "オープニング" });
  }
  // Ensure chapters are sorted
  parsed.chapters.sort((a, b) => a.timeSec - b.timeSec);

  return parsed;
}

/**
 * Build a Renoise-ready prompt by appending the project's video style guide.
 */
export function buildVideoPromptForRenoise(basePrompt: string): string {
  const style = loadStyle();
  return [
    basePrompt,
    "",
    "Style guide (must follow):",
    style.generation.videoStyleGuide,
    "",
    `Avoid: ${style.generation.videoNegative}`,
  ].join("\n");
}
