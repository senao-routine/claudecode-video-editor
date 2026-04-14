/**
 * Gemini-Vision-based quality gate for generated B-roll images.
 *
 * The image retry loop in gemini.ts used to be "hope the next generation is
 * better" because the image model doesn't return text tokens we could
 * inspect. This module turns that loop into a real quality gate by feeding
 * the generated image back into a vision-capable Gemini model (flash) and
 * asking it to report on text correctness.
 *
 * The cost per call is roughly 1/400th of the image generation itself, so
 * running verification on every image is effectively free.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface VerificationResult {
  /** True if the image contains English letters / romaji / Latin alphabet */
  hasEnglishText: boolean;
  /** True if Japanese characters appear but look garbled / fake / broken */
  hasBrokenJapanese: boolean;
  /** True if there is any text at all */
  hasAnyText: boolean;
  /** Short description of what's in the image (max ~100 chars) */
  description: string;
  /** Overall quality bucket */
  overallQuality: "good" | "acceptable" | "poor";
}

/**
 * Inspect a generated image with Gemini Vision and report quality issues.
 *
 * A well-known brand name rendered correctly (e.g. "Canva") does NOT count
 * as English text for this check — only rogue letters, romaji, or text
 * that should be Japanese but isn't.
 */
export async function verifyGeneratedImage(
  imagePath: string,
): Promise<VerificationResult> {
  const client = new GoogleGenerativeAI(config.gemini.apiKey);
  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const imageData = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  const prompt = `You are a strict quality inspector for a Japanese AI/IT YouTube channel's B-roll illustrations. Examine this image and report whether it meets the quality bar for a professional Japanese explainer video.

Return JSON that matches this schema exactly (no extra fields, no commentary):
{
  "hasEnglishText": boolean,
  "hasBrokenJapanese": boolean,
  "hasAnyText": boolean,
  "description": string,
  "overallQuality": "good" | "acceptable" | "poor"
}

# Rules

**hasEnglishText** = true if the image contains ANY of:
- English sentences or phrases
- Random English words or single letters used as labels
- Romaji (Japanese words written in Latin alphabet)
- Fake/placeholder English like "Lorem ipsum"

**hasEnglishText** = false if:
- The image has no text at all
- The only Latin text is a well-established brand/product name (Canva, ChatGPT, Google, NotebookLM, etc.)
- The only Latin text is a very short, intentional tech term like "AI" or "API"

**hasBrokenJapanese** = true if:
- Japanese-looking characters appear but they are garbled, mangled, or not real Japanese
- Kanji look right but are actually fake/invented glyphs
- Characters are distorted to the point of being unreadable

**hasAnyText** = true if any readable text appears in the image (English, Japanese, or otherwise). Used for logging.

**description** = a single sentence in Japanese (maximum 80 characters) describing what the image shows. Example: "タブレット上にレイヤー化された画像を表示するモダンなイラスト"

**overallQuality**:
- "good" = clean, professional, matches Japanese explainer aesthetic, no text issues
- "acceptable" = minor issues but still usable in the video
- "poor" = broken text, low quality, or unusable as B-roll`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: imageData.toString("base64"), mimeType } },
  ]);

  const text = result.response.text();
  return JSON.parse(text) as VerificationResult;
}
