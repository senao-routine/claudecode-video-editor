import React from "react";
import { Composition } from "remotion";
import { MainVideo } from "./compositions/MainVideo";
import { ShortVideo } from "./compositions/ShortVideo";
import { mainVideoSchema, shortVideoSchema, type StyleProps } from "./types";

const FPS = 30;

// Minimal placeholder style used only for the Remotion Studio default
// preview. Real renders always pass a fully-resolved style from
// `config/style.json` via inputProps.
const placeholderStyle: StyleProps = {
  subtitles: {
    main: {
      fontFamily: "sans-serif",
      fontWeight: 900,
      fontSizeRatio: 0.03,
      bottomRatio: 0.07,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidthRatio: 0.08,
      shadow: "0 4px 16px rgba(0,0,0,0.6)",
      lineHeight: 1.25,
      maxWidthRatio: 0.86,
    },
    short: {
      fontFamily: "sans-serif",
      fontWeight: 900,
      fontSizeRatio: 0.058,
      bottomRatio: 0.18,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidthRatio: 0.08,
      shadow: "0 4px 16px rgba(0,0,0,0.6)",
      lineHeight: 1.25,
      maxWidthRatio: 0.88,
    },
  },
  broll: {
    defaultMode: "fullscreen",
    fadeInSec: 0.25,
    fadeOutSec: 0.25,
    pip: {
      widthRatio: 0.35,
      marginRatio: 0.02,
      borderColor: "rgba(255,255,255,0.9)",
      borderWidth: 4,
      borderRadius: 16,
      shadow: "0 12px 40px rgba(0,0,0,0.5)",
      position: "top-right",
    },
    fullscreen: {
      backgroundColor: "#000000",
      objectFit: "contain",
    },
  },
  shortVideo: {
    background: "#0b0b10",
    title: {
      fontFamily: "sans-serif",
      fontWeight: 900,
      fontSizeRatio: 0.072,
      color: "#FFE14A",
      strokeColor: "#000000",
      strokeWidth: 4,
      topRatio: 0.06,
      fadeInSec: 0.3,
      holdSec: 1.9,
      fadeOutSec: 0.4,
    },
    hookText: {
      fontFamily: "sans-serif",
      fontWeight: 700,
      fontSizeRatio: 0.038,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 2,
      topRatio: 0.165,
    },
  },
};

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="MainVideo"
        component={MainVideo}
        durationInFrames={FPS * 60}
        fps={FPS}
        width={1920}
        height={1080}
        schema={mainVideoSchema}
        defaultProps={{
          videoUrl: "",
          durationSec: 60,
          fps: FPS,
          transcript: { text: "", language: "ja", segments: [], words: [] },
          broll: [],
          style: placeholderStyle,
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.ceil(props.durationSec * props.fps),
          fps: props.fps,
        })}
      />
      <Composition
        id="ShortVideo"
        component={ShortVideo}
        durationInFrames={FPS * 45}
        fps={FPS}
        width={1080}
        height={1920}
        schema={shortVideoSchema}
        defaultProps={{
          videoUrl: "",
          durationSec: 45,
          fps: FPS,
          transcript: { text: "", language: "ja", segments: [], words: [] },
          title: "",
          hookText: "",
          style: placeholderStyle,
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.ceil(props.durationSec * props.fps),
          fps: props.fps,
        })}
      />
    </>
  );
};
