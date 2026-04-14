import React from "react";
import {
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { BRollItem, StyleProps } from "../types";

interface Props {
  broll: BRollItem[];
  style: StyleProps;
}

/**
 * Renders B-roll on top of the base screen recording.
 *
 * Each B-roll item picks one of two display modes:
 *   - "pip"        — small picture-in-picture overlay (corner)
 *   - "fullscreen" — replaces the entire frame for the clip's duration
 *
 * The mode is decided per item by Gemini at planning time and stored on
 * `BRollItem.displayMode`. All visual properties come from the style
 * config.
 */
export const BRollLayer: React.FC<Props> = ({ broll, style }) => {
  return (
    <>
      {broll.map((b) => {
        if (!b.assetUrl) return null;
        return (
          <SingleBRoll key={b.id} item={b} style={style} />
        );
      })}
    </>
  );
};

const SingleBRoll: React.FC<{ item: BRollItem; style: StyleProps }> = ({
  item,
  style,
}) => {
  const { fps, width, height } = useVideoConfig();
  const startFrame = Math.floor(item.cutStartSec * fps);
  const durationFrames = Math.max(
    1,
    Math.ceil((item.cutEndSec - item.cutStartSec) * fps),
  );
  const resolvedSrc = staticFile(item.assetUrl as string);

  return (
    <Sequence from={startFrame} durationInFrames={durationFrames}>
      {item.displayMode === "fullscreen" ? (
        <FullscreenBRoll
          item={item}
          src={resolvedSrc}
          style={style}
          width={width}
          height={height}
          fps={fps}
          durationFrames={durationFrames}
        />
      ) : (
        <PipBRoll
          item={item}
          src={resolvedSrc}
          style={style}
          width={width}
          height={height}
        />
      )}
    </Sequence>
  );
};

const FullscreenBRoll: React.FC<{
  item: BRollItem;
  src: string;
  style: StyleProps;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
}> = ({ item, src, style, width, height, fps, durationFrames }) => {
  const frame = useCurrentFrame();
  const fadeInFrames = Math.floor(style.broll.fadeInSec * fps);
  const fadeOutFrames = Math.floor(style.broll.fadeOutSec * fps);
  const opacity = interpolate(
    frame,
    [
      0,
      fadeInFrames,
      durationFrames - fadeOutFrames,
      durationFrames,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        backgroundColor: style.broll.fullscreen.backgroundColor,
        opacity,
      }}
    >
      {item.kind === "image" ? (
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: style.broll.fullscreen.objectFit,
          }}
        />
      ) : (
        <OffthreadVideo
          src={src}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: style.broll.fullscreen.objectFit,
          }}
        />
      )}
    </div>
  );
};

const PipBRoll: React.FC<{
  item: BRollItem;
  src: string;
  style: StyleProps;
  width: number;
  height: number;
}> = ({ item, src, style, width, height }) => {
  const pip = style.broll.pip;
  const pipW = Math.floor(width * pip.widthRatio);
  const pipH = Math.floor(pipW * (9 / 16));
  const margin = Math.floor(width * pip.marginRatio);
  const horizontal = pip.position.endsWith("right") ? width - pipW - margin : margin;
  const vertical = pip.position.startsWith("top") ? margin : height - pipH - margin;

  return (
    <div
      style={{
        position: "absolute",
        left: horizontal,
        top: vertical,
        width: pipW,
        height: pipH,
        borderRadius: pip.borderRadius,
        overflow: "hidden",
        boxShadow: pip.shadow,
        border: `${pip.borderWidth}px solid ${pip.borderColor}`,
      }}
    >
      {item.kind === "image" ? (
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <OffthreadVideo
          src={src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </div>
  );
};
