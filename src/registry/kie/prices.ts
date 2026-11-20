/**
 * What kie.ai charges, per model and per combination of settings, so the price shows before
 * Generate and the credits are held up front.
 *
 * Source: kie.ai's own price list (POST /client/v1/model-pricing/page), checked against real
 * generations on 2026-11-20: every price below matched `creditsConsumed` exactly. 1 kie credit
 * is US$ 0.005. Nothing here imports Node or React, so the browser and the server price alike.
 *
 * To add or fix a price: change the table, then run `npm run check:registry`.
 */

export const KIE_USD_PER_CREDIT = 0.005;

type Input = Record<string, unknown>;

export interface KieQuote {
  /** What kie.ai will charge, in US dollars. */
  usd: number;
  /** False when the model or the setting is not in the table: nothing may be sold at this price. */
  exact: boolean;
  /** True when kie bills by usage, so the real charge may be lower than this ceiling. */
  metered: boolean;
}

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const lower = (v: unknown) => String(v ?? "").toLowerCase();
const chars = (text: unknown) => Array.from(String(text ?? "")).length;

const quote = (credits: number | undefined, metered = false): KieQuote =>
  credits === undefined || !Number.isFinite(credits) ? { usd: 0, exact: false, metered } : { usd: credits * KIE_USD_PER_CREDIT, exact: true, metered };

/** Credits for one image, by resolution. */
const IMAGE_BY_RES: Record<string, Record<string, number>> = {
  "nano-banana-2": { "1k": 8, "2k": 12, "4k": 18 },
  "nano-banana-pro": { "1k": 18, "2k": 18, "4k": 24 },
  "gpt-image-2-text-to-image": { "1k": 6, "2k": 10, "4k": 16 },
  "gpt-image-2-image-to-image": { "1k": 6, "2k": 10, "4k": 16 },
  "flux-3/klein-text-to-image": { "1k": 1.6, "2k": 2.5, "4k": 6.5 },
};

/** Seedream 5.5 prices by `size`, not `resolution`. */
const SEEDREAM_55: Record<string, number> = { "1k": 3.6, "1.5k": 3.6, "2k": 6.3 };

/** Veo 3.1 is priced per video: tier (`input.model`) by resolution. */
const VEO: Record<string, Record<string, number>> = {
  veo3: { "720p": 250, "1080p": 255 },
  veo3_fast: { "720p": 60, "1080p": 65 },
  veo3_lite: { "720p": 30, "1080p": 35 },
};

/** Kling 3.0 per second. `std` is 720p and `pro` is 1080p; sound costs more. */
const KLING: Record<string, { silent: number; sound: number }> = {
  std: { silent: 15.1, sound: 22.7 },
  pro: { silent: 20.2, sound: 30.2 },
};

/** Seedance 2.5 per second, with no reference video. */
const SEEDANCE_25: Record<string, number> = { "480p": 28, "720p": 63, "1080p": 158 };

/** Wan 3.0 per second, with no reference video. */
const WAN_3: Record<string, number> = { "480p": 8, "720p": 16, "1080p": 32 };

/** Grok Imagine per second. */
const GROK: Record<string, number> = { "480p": 2.4, "720p": 4.5, "1080p": 8 };

/** ElevenLabs bills every started 1,000 characters. */
const ELEVEN_PER_1000: Record<string, number> = { "elevenlabs/text-to-speech-multilingual-v2": 12, "elevenlabs/text-to-speech-turbo-2-5": 6 };

/**
 * Gemini TTS bills tokens: text in, audio out. A spoken character is about 1.7 audio tokens, at
 * 1,260 credits per million. The ceiling below covers that with room to spare, and the member is
 * refunded the difference after the real charge is known.
 */
const GEMINI_TTS_CREDITS_PER_CHAR = 0.0035;
const GEMINI_TTS_MIN = 0.2;

/** Suno bills per request, whatever the length. */
const SUNO = 12;

export function kieQuote(model: string, input: Input): KieQuote {
  const res = lower(input.resolution);

  if (model in IMAGE_BY_RES) {
    const n = model.startsWith("flux-3") ? Math.max(1, num(input.num_images, 1)) : 1;
    const per = IMAGE_BY_RES[model][res];
    return quote(per === undefined ? undefined : per * n);
  }
  if (model === "seedream/5-5-text-to-image") return quote(SEEDREAM_55[lower(input.size)]);

  if (model === "veo-3-1") return quote(VEO[lower(input.model)]?.[res]);

  if (model === "kling-3.0/video") {
    const row = KLING[lower(input.mode)];
    if (!row) return quote(undefined);
    return quote((input.sound ? row.sound : row.silent) * Math.max(0, num(input.duration)));
  }
  if (model === "bytedance/seedance-2-5") {
    const per = SEEDANCE_25[res];
    return quote(per === undefined ? undefined : per * Math.max(0, num(input.duration)));
  }
  if (model === "wan/3-0-video") {
    const per = WAN_3[res];
    return quote(per === undefined ? undefined : per * Math.max(0, num(input.duration)));
  }
  if (model === "grok-imagine/text-to-video") {
    const per = GROK[res];
    return quote(per === undefined ? undefined : per * Math.max(0, num(input.duration)));
  }

  if (model in ELEVEN_PER_1000) return quote(ELEVEN_PER_1000[model] * Math.max(1, Math.ceil(chars(input.text) / 1000)));
  if (model === "google/gemini-3-8-flash-tts") {
    const turns = Array.isArray(input.dialogue_turns) ? (input.dialogue_turns as { text?: unknown }[]) : [];
    const total = turns.reduce((n, t) => n + chars(t.text), 0);
    return quote(Math.max(GEMINI_TTS_MIN, total * GEMINI_TTS_CREDITS_PER_CHAR), true);
  }
  if (model === "ai-music-api/generate" || model === "ai-music-api/speech") return quote(SUNO);

  return quote(undefined);
}

/** Every kie.ai model string this app can call. A request for anything else is refused. */
export const KIE_MODELS = new Set<string>([
  ...Object.keys(IMAGE_BY_RES),
  "seedream/5-5-text-to-image",
  "veo-3-1",
  "kling-3.0/video",
  "bytedance/seedance-2-5",
  "wan/3-0-video",
  "grok-imagine/text-to-video",
  ...Object.keys(ELEVEN_PER_1000),
  "google/gemini-3-8-flash-tts",
  "ai-music-api/generate",
  "ai-music-api/speech",
]);
