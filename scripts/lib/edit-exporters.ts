/**
 * Editor-friendly export writers.
 *
 * These functions take pipeline artifacts (transcripts, B-roll plans,
 * highlights) and write out files suitable for loading into Premiere Pro,
 * Filmora, DaVinci Resolve, or Final Cut Pro.
 *
 * All timestamps are on the POST-jetcut timeline so they line up with the
 * `jetcut.mp4` clip the user will load into their editor.
 */

import fs from "node:fs";
import path from "node:path";
import type { Transcript, TranscriptSegment } from "./whisper.js";

// ─────────────────────────────────────────────────────────────────────
// SRT
// ─────────────────────────────────────────────────────────────────────

function fmtSrtTime(sec: number): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}

/**
 * Write a transcript out as a SubRip (.srt) subtitle file. Uses the
 * provided segments verbatim — pass already-chunked segments if you want
 * the SRT to match the burned-in version.
 */
export function writeSrt(transcript: Transcript, outFile: string): void {
  const lines: string[] = [];
  transcript.segments.forEach((seg, i) => {
    lines.push(String(i + 1));
    lines.push(`${fmtSrtTime(seg.start)} --> ${fmtSrtTime(seg.end)}`);
    lines.push(seg.text.trim().replace(/\s+/g, " "));
    lines.push("");
  });
  fs.writeFileSync(outFile, lines.join("\n"));
}

// ─────────────────────────────────────────────────────────────────────
// ASS (Advanced SubStation Alpha)
// ─────────────────────────────────────────────────────────────────────

function fmtAssTime(sec: number): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const whole = Math.floor(s);
  const cs = Math.floor((s - whole) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export interface AssStyle {
  fontName: string;
  fontSize: number;
  primaryColor: string; // &H00BBGGRR& (alpha,blue,green,red)
  outlineColor: string;
  outlineWidth: number;
  marginV: number;
  videoWidth: number;
  videoHeight: number;
}

const DEFAULT_ASS_STYLE: AssStyle = {
  fontName: "Hiragino Sans W9",
  fontSize: 86,
  primaryColor: "&H00FFFFFF",
  outlineColor: "&H00000000",
  outlineWidth: 4,
  marginV: 76,
  videoWidth: 1920,
  videoHeight: 1080,
};

/**
 * Write a transcript out as an ASS (Advanced SubStation Alpha) subtitle
 * file. Includes a single Default style sized for the editor's working
 * resolution. Filmora, DaVinci, and Aegisub all read this format.
 */
export function writeAss(
  transcript: Transcript,
  outFile: string,
  style: Partial<AssStyle> = {},
): void {
  const s = { ...DEFAULT_ASS_STYLE, ...style };
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${s.videoWidth}
PlayResY: ${s.videoHeight}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontName},${s.fontSize},${s.primaryColor},&H000000FF,${s.outlineColor},&H80000000,1,0,0,0,100,100,0,0,1,${s.outlineWidth},2,2,60,60,${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = transcript.segments
    .map((seg) => {
      const text = seg.text.trim().replace(/\s+/g, " ").replace(/\n/g, "\\N");
      return `Dialogue: 0,${fmtAssTime(seg.start)},${fmtAssTime(seg.end)},Default,,0,0,0,,${text}`;
    })
    .join("\n");

  fs.writeFileSync(outFile, header + events + "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Markers (CSV / JSON)
// ─────────────────────────────────────────────────────────────────────

export interface Marker {
  /** Time on the post-jetcut timeline */
  timeSec: number;
  /** Optional duration if the marker spans a range */
  durationSec?: number;
  /** Marker category for filtering / grouping */
  type: "broll" | "highlight";
  /** Short label shown in the editor */
  label: string;
  /** Free-form notes / context */
  notes?: string;
}

export function writeMarkersJson(markers: Marker[], outFile: string): void {
  fs.writeFileSync(outFile, JSON.stringify(markers, null, 2));
}

/**
 * Write markers as Premiere-Pro-compatible CSV. Premiere can't import this
 * directly, but it's easy to read in any spreadsheet and the columns are
 * picked to match common marker workflows.
 */
export function writeMarkersCsv(markers: Marker[], outFile: string): void {
  const lines: string[] = [];
  lines.push("type,time_sec,time_hms,duration_sec,label,notes");
  for (const m of markers) {
    const hms = fmtSrtTime(m.timeSec).replace(",", ".");
    const escape = (v: string | undefined) => {
      if (!v) return "";
      const needs = v.includes(",") || v.includes('"') || v.includes("\n");
      return needs ? `"${v.replace(/"/g, '""')}"` : v;
    };
    lines.push(
      [
        m.type,
        m.timeSec.toFixed(3),
        hms,
        (m.durationSec ?? 0).toFixed(3),
        escape(m.label),
        escape(m.notes),
      ].join(","),
    );
  }
  fs.writeFileSync(outFile, lines.join("\n") + "\n");
}

// ─────────────────────────────────────────────────────────────────────
// FCP XML (Final Cut Pro 7 / Premiere Pro compatible)
// ─────────────────────────────────────────────────────────────────────

export interface FcpXmlOptions {
  videoFile: string; // absolute path to jetcut.mp4
  videoWidth: number;
  videoHeight: number;
  fps: number;
  durationSec: number;
  sequenceName: string;
  markers: Marker[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build a Premiere-Pro-compatible `file://localhost/...` URL from an
 * absolute filesystem path. Each path component is percent-encoded
 * individually so that `/` separators stay intact and UTF-8 characters
 * (Japanese, spaces, etc.) are escaped.
 */
function toFileUrl(absPath: string): string {
  // On macOS, paths start with "/" — split and encode each segment.
  const parts = absPath.split("/").map((p) => encodeURIComponent(p));
  return "file://localhost" + parts.join("/");
}

/**
 * Sanitize a filename to only ASCII-safe characters. Used as a fallback for
 * the <name> fields so Premiere's inspector doesn't choke on pure UTF-8.
 * The actual file on disk is referenced by the pathurl, so the display
 * name here is mostly cosmetic.
 */
function safeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 120);
}

/**
 * Emit a Final Cut Pro 7 XML file (xmeml v4) that Premiere Pro can import.
 *
 * Premiere's FCP7 XML importer is strict — this implementation is modeled
 * after what Premiere itself exports. Key requirements we honor:
 *
 *   - xmeml version 4 (not 5; Premiere writes v4)
 *   - Every <clipitem> has a <masterclipid> matching a master <clip>
 *   - A <timecode> element at the sequence level
 *   - The file reference uses `file://localhost/...` with UTF-8 segments
 *     percent-encoded individually
 *   - Video and audio are linked via <link> elements
 *   - Markers live INSIDE the <sequence> but AFTER </media>
 */
export function writeFcpXml(opts: FcpXmlOptions): string {
  const { videoFile, videoWidth, videoHeight, fps, durationSec } = opts;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const fileUrl = toFileUrl(videoFile);
  const fileName = path.basename(videoFile);
  const sequenceName = safeName(opts.sequenceName) || "sequence";

  const markersXml = opts.markers
    .map((m) => {
      const inFrame = Math.max(0, Math.round(m.timeSec * fps));
      const outFrame =
        m.durationSec && m.durationSec > 0
          ? Math.max(inFrame + 1, Math.round((m.timeSec + m.durationSec) * fps))
          : -1;
      return `    <marker>
      <comment>${escapeXml(m.notes ?? "")}</comment>
      <name>${escapeXml(`[${m.type}] ${m.label}`)}</name>
      <in>${inFrame}</in>
      <out>${outFrame}</out>
    </marker>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${escapeXml(sequenceName)}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <timecode>
      <rate>
        <timebase>${fps}</timebase>
        <ntsc>FALSE</ntsc>
      </rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <in>-1</in>
    <out>-1</out>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <width>${videoWidth}</width>
            <height>${videoHeight}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <colordepth>24</colordepth>
          </samplecharacteristics>
        </format>
        <track>
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
          <clipitem id="clipitem-1">
            <masterclipid>masterclip-1</masterclipid>
            <name>${escapeXml(fileName)}</name>
            <enabled>TRUE</enabled>
            <duration>${totalFrames}</duration>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-1">
              <name>${escapeXml(fileName)}</name>
              <pathurl>${fileUrl}</pathurl>
              <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
              </rate>
              <duration>${totalFrames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <rate>
                      <timebase>${fps}</timebase>
                      <ntsc>FALSE</ntsc>
                    </rate>
                    <width>${videoWidth}</width>
                    <height>${videoHeight}</height>
                    <anamorphic>FALSE</anamorphic>
                    <pixelaspectratio>square</pixelaspectratio>
                    <fielddominance>none</fielddominance>
                    <colordepth>24</colordepth>
                  </samplecharacteristics>
                </video>
                <audio>
                  <samplecharacteristics>
                    <depth>16</depth>
                    <samplerate>48000</samplerate>
                  </samplecharacteristics>
                  <channelcount>2</channelcount>
                </audio>
              </media>
            </file>
            <link>
              <linkclipref>clipitem-1</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>1</clipindex>
            </link>
            <link>
              <linkclipref>clipitem-2</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>1</clipindex>
              <groupindex>1</groupindex>
            </link>
          </clipitem>
        </track>
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track>
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
          <clipitem id="clipitem-2">
            <masterclipid>masterclip-1</masterclipid>
            <name>${escapeXml(fileName)}</name>
            <enabled>TRUE</enabled>
            <duration>${totalFrames}</duration>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-1"/>
            <sourcetrack>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
            </sourcetrack>
            <link>
              <linkclipref>clipitem-1</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>1</clipindex>
            </link>
            <link>
              <linkclipref>clipitem-2</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>1</clipindex>
              <groupindex>1</groupindex>
            </link>
          </clipitem>
        </track>
      </audio>
    </media>
${markersXml}
  </sequence>
</xmeml>
`;
}

// ─────────────────────────────────────────────────────────────────────
// EDL (CMX 3600)
// ─────────────────────────────────────────────────────────────────────

function fmtTimecode(sec: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(sec * fps));
  const h = Math.floor(totalFrames / (3600 * fps));
  const m = Math.floor((totalFrames % (3600 * fps)) / (60 * fps));
  const s = Math.floor((totalFrames % (60 * fps)) / fps);
  const f = totalFrames % fps;
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    ":" +
    String(f).padStart(2, "0")
  );
}

export interface EdlOptions {
  title: string;
  fps: number;
  durationSec: number;
  reelName?: string;
}

/**
 * Emit a minimal CMX 3600 EDL describing a single video+audio clip
 * spanning [00:00:00:00, durationSec]. Filmora, older Premiere, and
 * DaVinci all read this format.
 */
export function writeEdl(opts: EdlOptions): string {
  const reel = (opts.reelName ?? "JETCUT").slice(0, 8).padEnd(8, " ");
  const inTc = "00:00:00:00";
  const outTc = fmtTimecode(opts.durationSec, opts.fps);
  return `TITLE: ${opts.title}
FCM: NON-DROP FRAME

001  ${reel} V     C        ${inTc} ${outTc} ${inTc} ${outTc}
* FROM CLIP NAME: jetcut.mp4

002  ${reel} A     C        ${inTc} ${outTc} ${inTc} ${outTc}
* FROM CLIP NAME: jetcut.mp4
`;
}
