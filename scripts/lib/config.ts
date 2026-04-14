import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  openai: {
    get apiKey() {
      return required("OPENAI_API_KEY");
    },
    whisperModel: optional("WHISPER_MODEL", "whisper-1"),
  },
  gemini: {
    get apiKey() {
      return required("GEMINI_API_KEY");
    },
    model: optional("GEMINI_MODEL", "gemini-2.5-pro"),
  },
  renoise: {
    get apiKey() {
      return required("RENOISE_API_KEY");
    },
  },
  // Pipeline tuning knobs
  pipeline: {
    // Silence detection: anything quieter than this dB and longer than this
    // duration is treated as a cut candidate.
    silenceNoiseDb: -30,
    silenceMinDurationSec: 0.4,
    // Jet cut keeps this much pad around speech to avoid clipping consonants.
    jetcutPadSec: 0.08,
    // Whisper has a 25MB file limit; chunk audio into this many seconds.
    whisperChunkSec: 600, // 10 min
    // Short video target length (seconds).
    shortTargetSec: 45,
    shortMaxSec: 60,
  },
};
