/**
 * Renoise B-roll video generation.
 *
 * NOTE: The preferred way to generate Renoise videos in this project is
 * through the existing Claude Code skill `video-maker:renoise-gen`. That
 * skill handles task creation, polling, and downloading.
 *
 * This file exists as a placeholder for when you want to call Renoise
 * programmatically from a script (outside a Claude Code session). If you
 * invoke the pipeline from Claude Code, prefer asking Claude to run the
 * `video-maker:renoise-gen` skill for each planned B-roll video moment.
 */

import { config } from "./config.js";

export interface RenoiseVideoRequest {
  prompt: string;
  durationSec: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}

/**
 * Programmatic Renoise call — intentionally stubbed.
 *
 * Implement this only if you need unattended runs. For the normal
 * Claude-Code-driven workflow, use the `video-maker:renoise-gen` skill.
 */
export async function generateVideo(
  _req: RenoiseVideoRequest,
  _outFile: string,
): Promise<void> {
  // Touch the config so TS doesn't complain about unused imports; real
  // implementation would call Renoise's REST API here using config.renoise.apiKey.
  void config.renoise;
  throw new Error(
    "Direct Renoise API integration is not implemented. Use the `video-maker:renoise-gen` Claude Code skill for B-roll video generation, or implement this stub against the Renoise REST API.",
  );
}
