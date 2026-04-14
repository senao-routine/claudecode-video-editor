/**
 * Image generation via Renoise's nano-banana-2 model.
 *
 * This is an alternative backend to Gemini 2.5 Flash Image. It exists
 * primarily as a fallback when Gemini produces broken Japanese text — in
 * our testing, nano-banana-2 behaves somewhat differently and sometimes
 * succeeds where Gemini fails (and vice versa).
 *
 * Uses the `renoise-cli.mjs` shipped with the `video-maker:renoise-gen`
 * Claude Code plugin, so credentials come from the existing
 * `RENOISE_API_KEY` environment variable — no extra setup required.
 *
 * The CLI runs the task synchronously via `task generate`, polling until
 * completion and returning a JSON object with the result URL. We parse
 * that URL and download the image to `outFile`.
 */

import fs from "node:fs";
import path from "node:path";
import { run } from "./shell.js";

const RENOISE_CLI = path.join(
  process.env.HOME || "",
  ".claude/plugins/marketplaces/renoise-plugins-official/skills/renoise-gen/renoise-cli.mjs",
);

export interface RenoiseImageOptions {
  aspectRatio?: "16:9" | "9:16" | "1:1";
  resolution?: "1k" | "2k";
  tags?: string[];
}

export async function generateImageViaRenoise(
  prompt: string,
  outFile: string,
  opts: RenoiseImageOptions = {},
): Promise<void> {
  if (!fs.existsSync(RENOISE_CLI)) {
    throw new Error(
      `Renoise CLI not found at ${RENOISE_CLI}. Is the video-maker plugin installed?`,
    );
  }

  const aspectRatio = opts.aspectRatio ?? "16:9";
  const resolution = opts.resolution ?? "2k";

  const args = [
    RENOISE_CLI,
    "task",
    "generate",
    "--prompt",
    prompt,
    "--model",
    "nano-banana-2",
    "--ratio",
    aspectRatio,
    "--resolution",
    resolution,
  ];
  if (opts.tags && opts.tags.length > 0) {
    args.push("--tags", opts.tags.join(","));
  }

  const { stdout } = await run("node", args, { quiet: true });

  // The CLI prints a JSON blob at the end with the result URL. Find the
  // last complete JSON object in the output (there may be log lines above).
  const url = extractImageUrl(stdout);
  if (!url) {
    throw new Error(
      `Renoise CLI returned no image URL. Output:\n${stdout.slice(-500)}`,
    );
  }

  // Download the image to the destination file.
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Renoise image (${response.status}): ${response.statusText}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outFile, buffer);
}

/**
 * Pull the result URL out of the Renoise CLI's stdout. The CLI prints
 * human-readable status lines as it polls, then a final JSON object with
 * the completed task. We tolerate whichever field name the CLI uses.
 */
function extractImageUrl(stdout: string): string | null {
  // Try to parse the last JSON-looking block
  const jsonMatches = [...stdout.matchAll(/\{[\s\S]*?\}/g)];
  for (let i = jsonMatches.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(jsonMatches[i][0]);
      const url = obj.imageUrl || obj.resultUrl || obj.videoUrl || obj.url;
      if (typeof url === "string" && url.startsWith("http")) return url;
    } catch {
      // Not valid JSON, keep searching
    }
  }
  // Fallback: grep for any https URL ending in .png / .jpg / .webp
  const urlMatch = stdout.match(
    /https:\/\/[^\s"')]+\.(?:png|jpg|jpeg|webp)[^\s"')]*/i,
  );
  if (urlMatch) return urlMatch[0];
  // Last resort: any http URL
  const anyUrl = stdout.match(/https:\/\/[^\s"')]+/);
  return anyUrl ? anyUrl[0] : null;
}
