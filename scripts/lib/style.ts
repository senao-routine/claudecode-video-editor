import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
import { chunkTranscript as chunkTranscriptImpl, type ChunkingConfig } from "./subtitle-chunks.js";
import type { Transcript } from "./whisper.js";

/**
 * Style config — the SINGLE source of truth for fonts, subtitle styling,
 * B-roll display behavior, and AI generation style guides.
 *
 * Edit `config/style.json` to change anything visual or generative.
 * See `config/README.md` for the full reference.
 */

export type { ChunkingConfig };

export interface StyleConfig {
  fonts: Record<string, string>;
  subtitles: {
    chunking: ChunkingConfig;
    main: SubtitleStyle;
    short: SubtitleStyle;
  };
  broll: {
    defaultMode: "pip" | "fullscreen";
    fadeInSec: number;
    fadeOutSec: number;
    pip: PipStyle;
    fullscreen: FullscreenStyle;
  };
  shortVideo: {
    background: string;
    title: TitleStyle;
    hookText: HookStyle;
  };
  generation: {
    language: string;
    /** Primary image backend. "gemini" calls Google AI Studio directly, "renoise" calls Renoise CLI. */
    imagePrimaryModel: "gemini" | "renoise";
    /** Fallback image backend used when the primary fails verification. Set to "none" to disable fallback. */
    imageFallbackModel: "gemini" | "renoise" | "none";
    /** Gemini image model id (e.g. "gemini-3.1-flash-image-preview" for NanoBanana 2). */
    imageGeminiModelId: string;
    /** Total number of generation attempts across all backends. */
    imageMaxAttempts: number;
    /** Whether to run OCR verification on every generated image. */
    imageVerify: boolean;
    /** Aspect ratio requested from the backend. */
    imageAspectRatio: "16:9" | "9:16" | "1:1";
    /** Image resolution (Renoise only — Gemini doesn't expose this). */
    imageResolution: "1k" | "2k";
    imageStyleGuide: string;
    imageNegative: string;
    videoStyleGuide: string;
    videoNegative: string;
    preferredAspectRatio: string;
  };
}

export interface SubtitleStyle {
  fontFamily: string;
  fontWeight: number;
  fontSizeRatio: number;
  bottomRatio: number;
  color: string;
  strokeColor: string;
  strokeWidthRatio: number;
  shadow: string;
  lineHeight: number;
  maxWidthRatio: number;
}

export interface PipStyle {
  widthRatio: number;
  marginRatio: number;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  shadow: string;
  position: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

export interface FullscreenStyle {
  backgroundColor: string;
  objectFit: "contain" | "cover";
}

export interface TitleStyle {
  fontFamily: string;
  fontWeight: number;
  fontSizeRatio: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  topRatio: number;
  fadeInSec: number;
  holdSec: number;
  fadeOutSec: number;
}

export interface HookStyle {
  fontFamily: string;
  fontWeight: number;
  fontSizeRatio: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  topRatio: number;
}

let cached: StyleConfig | null = null;

export function loadStyle(): StyleConfig {
  if (cached) return cached;
  const file = path.join(ROOT, "config", "style.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `Style config not found at ${file}. See config/README.md.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as StyleConfig;
  cached = resolveFontAliases(raw);
  return cached;
}

/**
 * Split each transcript segment into short, readable chunks (typically 2–8
 * characters each) per the project's chunking config. The result is a new
 * Transcript whose segments are timed to flip in sequence over the original
 * Whisper window — so the on-screen subtitle font can stay constant.
 *
 * This is the modern replacement for the old line-wrap approach: instead of
 * fitting a long sentence on one line at a smaller font size, we keep the
 * font size fixed and break the sentence across multiple subtitle frames.
 */
export function chunkTranscript(
  transcript: Transcript,
  cfg: ChunkingConfig,
): Transcript {
  return chunkTranscriptImpl(transcript, cfg);
}

/**
 * Replace `fontFamily: "japanese"` with the resolved font stack from
 * `fonts.japanese`. If the value is already a real CSS font-family string
 * (contains a comma or unknown key), pass it through unchanged.
 */
function resolveFontAliases(cfg: StyleConfig): StyleConfig {
  const resolve = (v: string) => (cfg.fonts[v] ? cfg.fonts[v] : v);
  return {
    ...cfg,
    subtitles: {
      chunking: cfg.subtitles.chunking,
      main: { ...cfg.subtitles.main, fontFamily: resolve(cfg.subtitles.main.fontFamily) },
      short: { ...cfg.subtitles.short, fontFamily: resolve(cfg.subtitles.short.fontFamily) },
    },
    shortVideo: {
      ...cfg.shortVideo,
      title: { ...cfg.shortVideo.title, fontFamily: resolve(cfg.shortVideo.title.fontFamily) },
      hookText: {
        ...cfg.shortVideo.hookText,
        fontFamily: resolve(cfg.shortVideo.hookText.fontFamily),
      },
    },
  };
}
