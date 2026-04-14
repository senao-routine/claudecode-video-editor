import type { SpeechRange } from "./ffmpeg.js";
import type { Transcript, TranscriptSegment, WordTimestamp } from "./whisper.js";

/**
 * After a jet cut, the original timeline is compressed: silences are gone
 * and the kept ranges are glued back-to-back. Every subsequent stage that
 * wants to display captions, show B-roll, or extract a short must be able
 * to convert a timestamp on the ORIGINAL timeline into the POST-CUT
 * timeline.
 *
 * Call `mapOriginalToCut(tOriginal)` to get the corresponding time on the
 * jet-cut track, or `null` if the original time fell inside a silence
 * that was removed (in which case the caller should snap to a range edge).
 */
export function makeTimelineMapper(ranges: SpeechRange[]) {
  // Pre-compute cumulative offsets so the lookup is O(log n) via binary search.
  const cumStarts: number[] = [0];
  for (let i = 0; i < ranges.length; i++) {
    cumStarts.push(cumStarts[i] + (ranges[i].end - ranges[i].start));
  }

  function mapOriginalToCut(tOriginal: number): number | null {
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (tOriginal < r.start) return null; // fell in a removed silence
      if (tOriginal <= r.end) {
        return cumStarts[i] + (tOriginal - r.start);
      }
    }
    return null; // past the end
  }

  /** Snap to nearest range edge if the time is inside a removed silence. */
  function snapOriginalToCut(tOriginal: number): number {
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (tOriginal < r.start) {
        return cumStarts[i]; // snap forward to start of next range
      }
      if (tOriginal <= r.end) {
        return cumStarts[i] + (tOriginal - r.start);
      }
    }
    return cumStarts[cumStarts.length - 1];
  }

  return { mapOriginalToCut, snapOriginalToCut };
}

/**
 * Return a new transcript with all timestamps rewritten to the post-cut
 * timeline. Segments and words whose ranges were entirely cut out get
 * dropped.
 */
export function remapTranscript(
  transcript: Transcript,
  ranges: SpeechRange[],
): Transcript {
  const { snapOriginalToCut, mapOriginalToCut } = makeTimelineMapper(ranges);

  const segments: TranscriptSegment[] = [];
  for (const seg of transcript.segments) {
    // Skip segments whose entire body was cut
    const anyStart = mapOriginalToCut(seg.start) ?? mapOriginalToCut(seg.end);
    if (anyStart === null) continue;
    segments.push({
      id: segments.length,
      start: snapOriginalToCut(seg.start),
      end: snapOriginalToCut(seg.end),
      text: seg.text,
    });
  }

  const words: WordTimestamp[] = [];
  for (const w of transcript.words) {
    const start = mapOriginalToCut(w.start);
    if (start === null) continue;
    words.push({
      word: w.word,
      start,
      end: snapOriginalToCut(w.end),
    });
  }

  return {
    text: transcript.text,
    language: transcript.language,
    segments,
    words,
  };
}
