import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { Subtitles } from "../components/Subtitles";
import { BRollLayer } from "../components/BRollLayer";
import type { MainVideoProps } from "../types";

/**
 * 16:9 explainer composition.
 *
 *   base layer  = jet-cut screen recording
 *   mid layer   = B-roll (PiP or fullscreen, decided per clip)
 *   top layer   = subtitles
 *
 * All visual styling comes from `props.style`, which the orchestrator
 * loads from `config/style.json`.
 */
export const MainVideo: React.FC<MainVideoProps> = ({
  videoUrl,
  transcript,
  broll,
  style,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo src={staticFile(videoUrl)} />
      <BRollLayer broll={broll} style={style} />
      <Subtitles segments={transcript.segments} variant="main" style={style} />
    </AbsoluteFill>
  );
};
