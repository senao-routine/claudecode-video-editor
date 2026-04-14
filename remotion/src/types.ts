import { z } from "zod";

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.string(),
  segments: z.array(
    z.object({
      id: z.number(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
    }),
  ),
  words: z.array(
    z.object({
      word: z.string(),
      start: z.number(),
      end: z.number(),
    }),
  ),
});

export const brollItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  displayMode: z.enum(["pip", "fullscreen"]),
  cutStartSec: z.number(),
  cutEndSec: z.number(),
  topic: z.string(),
  assetUrl: z.string().nullable(),
});

const subtitleStyleSchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSizeRatio: z.number(),
  bottomRatio: z.number(),
  color: z.string(),
  strokeColor: z.string(),
  strokeWidthRatio: z.number(),
  shadow: z.string(),
  lineHeight: z.number(),
  maxWidthRatio: z.number(),
});

const pipStyleSchema = z.object({
  widthRatio: z.number(),
  marginRatio: z.number(),
  borderColor: z.string(),
  borderWidth: z.number(),
  borderRadius: z.number(),
  shadow: z.string(),
  position: z.enum(["top-right", "top-left", "bottom-right", "bottom-left"]),
});

const fullscreenStyleSchema = z.object({
  backgroundColor: z.string(),
  objectFit: z.enum(["contain", "cover"]),
});

const titleStyleSchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSizeRatio: z.number(),
  color: z.string(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  topRatio: z.number(),
  fadeInSec: z.number(),
  holdSec: z.number(),
  fadeOutSec: z.number(),
});

const hookStyleSchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSizeRatio: z.number(),
  color: z.string(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  topRatio: z.number(),
});

export const styleSchema = z.object({
  subtitles: z.object({
    main: subtitleStyleSchema,
    short: subtitleStyleSchema,
  }),
  broll: z.object({
    defaultMode: z.enum(["pip", "fullscreen"]),
    fadeInSec: z.number(),
    fadeOutSec: z.number(),
    pip: pipStyleSchema,
    fullscreen: fullscreenStyleSchema,
  }),
  shortVideo: z.object({
    background: z.string(),
    title: titleStyleSchema,
    hookText: hookStyleSchema,
  }),
});

export const mainVideoSchema = z.object({
  videoUrl: z.string(),
  durationSec: z.number(),
  fps: z.number(),
  transcript: transcriptSchema,
  broll: z.array(brollItemSchema),
  style: styleSchema,
});

export const shortVideoSchema = z.object({
  videoUrl: z.string(),
  durationSec: z.number(),
  fps: z.number(),
  transcript: transcriptSchema,
  title: z.string(),
  hookText: z.string(),
  style: styleSchema,
});

export type MainVideoProps = z.infer<typeof mainVideoSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoSchema>;
export type StyleProps = z.infer<typeof styleSchema>;
export type BRollItem = z.infer<typeof brollItemSchema>;
