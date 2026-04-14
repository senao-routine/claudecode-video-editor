import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { MainVideoProps, StyleProps } from "../types";

interface Props {
  segments: MainVideoProps["transcript"]["segments"];
  variant: "main" | "short";
  style: StyleProps;
}

/**
 * Timed subtitle renderer.
 *
 *   - Always rendered on a SINGLE LINE (white-space: nowrap)
 *   - Font size is FIXED at `fontSizeRatio` of the composition width.
 *     Long sentences are not shrunk; instead, they are split into
 *     multiple short chunks upstream by chunkTranscript() so the on-screen
 *     text size is stable across the whole video.
 *   - Anchored to the bottom of the frame via `bottomRatio`
 *
 * All visual properties come from `config/style.json`.
 */
export const Subtitles: React.FC<Props> = ({ segments, variant, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const active = segments.find((s) => t >= s.start && t <= s.end);
  if (!active) return null;

  const cfg = style.subtitles[variant];
  const fontSize = Math.floor(width * cfg.fontSizeRatio);
  const bottom = Math.floor(height * cfg.bottomRatio);
  const maxWidth = Math.floor(width * cfg.maxWidthRatio);
  const strokeWidth = Math.max(2, Math.floor(fontSize * cfg.strokeWidthRatio));

  // Always single-line. Any whitespace inside the chunk is collapsed.
  const text = active.text.replace(/\s+/g, " ").trim();

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom,
        transform: "translateX(-50%)",
        maxWidth,
        textAlign: "center",
        fontFamily: cfg.fontFamily,
        fontWeight: cfg.fontWeight,
        fontSize,
        color: cfg.color,
        WebkitTextStroke: `${strokeWidth}px ${cfg.strokeColor}`,
        textShadow: cfg.shadow,
        lineHeight: cfg.lineHeight,
        padding: "0 24px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
};
