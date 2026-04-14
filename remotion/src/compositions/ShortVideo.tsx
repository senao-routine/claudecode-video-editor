import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { Subtitles } from "../components/Subtitles";
import type { ShortVideoProps } from "../types";

/**
 * 9:16 vertical short composition.
 *
 *   base layer  = vertically-cropped highlight clip
 *   title       = catchy headline at top with fade in/out
 *   hook        = one-line hook below the title
 *   subtitles   = auto captions in the lower third
 *
 * All visual styling comes from `props.style` (from `config/style.json`).
 */
export const ShortVideo: React.FC<ShortVideoProps> = ({
  videoUrl,
  transcript,
  title,
  hookText,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const titleCfg = style.shortVideo.title;
  const hookCfg = style.shortVideo.hookText;

  const fadeIn = fps * titleCfg.fadeInSec;
  const holdEnd = fps * (titleCfg.fadeInSec + titleCfg.holdSec);
  const fadeOutEnd = fps * (titleCfg.fadeInSec + titleCfg.holdSec + titleCfg.fadeOutSec);
  const titleOpacity = interpolate(
    frame,
    [0, fadeIn, holdEnd, fadeOutEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const scaledVideoHeight = (width * 9) / 16;
  const videoTop = (height - scaledVideoHeight) / 2;

  return (
    <AbsoluteFill style={{ backgroundColor: style.shortVideo.background }}>
      <div
        style={{
          position: "absolute",
          top: videoTop,
          left: 0,
          width,
          height: scaledVideoHeight,
        }}
      >
        <OffthreadVideo
          src={staticFile(videoUrl)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: Math.floor(height * titleCfg.topRatio),
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: Math.floor(width * 0.9),
          textAlign: "center",
          fontFamily: titleCfg.fontFamily,
          fontWeight: titleCfg.fontWeight,
          fontSize: Math.floor(width * titleCfg.fontSizeRatio),
          color: titleCfg.color,
          WebkitTextStroke: `${titleCfg.strokeWidth}px ${titleCfg.strokeColor}`,
          textShadow: "0 6px 24px rgba(0,0,0,0.7)",
          opacity: titleOpacity,
        }}
      >
        {title}
      </div>

      {hookText && (
        <div
          style={{
            position: "absolute",
            top: Math.floor(height * hookCfg.topRatio),
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: Math.floor(width * 0.86),
            textAlign: "center",
            fontFamily: hookCfg.fontFamily,
            fontWeight: hookCfg.fontWeight,
            fontSize: Math.floor(width * hookCfg.fontSizeRatio),
            color: hookCfg.color,
            WebkitTextStroke: `${hookCfg.strokeWidth}px ${hookCfg.strokeColor}`,
            opacity: titleOpacity,
          }}
        >
          {hookText}
        </div>
      )}

      <Subtitles segments={transcript.segments} variant="short" style={style} />
    </AbsoluteFill>
  );
};
