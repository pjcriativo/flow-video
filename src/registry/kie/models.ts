/**
 * Models served by kie.ai. A model whose `id` already exists in the base registry replaces it
 * (same name in the studios, new provider); the rest are added.
 *
 * `endpoint` is `kie:<model string>` and `body` is kie's own `input` object, unchanged. Prices
 * come from `./prices.ts`. Every parameter name and allowed value here was checked against the
 * model's page on docs.kie.ai and, for the ones marked tested, against a real generation.
 */
import { aspect, compact, duration, opt, resolution, select, slider, toggle } from "../helpers";
import type { BuildContext, Control, MediaSlot, ModelDef, Option } from "../types";

const kie = (model: string) => `kie:${model}`;

const IMAGE_PROMPT = { required: true, maxLength: 3000, placeholder: "Describe the image: subject, setting, light, lens, mood." };
const VIDEO_PROMPT = { required: true, maxLength: 2500, placeholder: "Describe the shot: subject, action, camera, light." };
const SCRIPT = { required: true, maxLength: 5000, label: "Script", placeholder: "Type what the voice should say." };

const refs = (max: number, hint = "Images to edit, combine or borrow a look from."): MediaSlot => ({ id: "refs", label: "References", hint, accept: ["image"], min: 0, max });
const START: MediaSlot = { id: "start", label: "Start frame", hint: "The first frame of the shot.", accept: ["image"], min: 0, max: 1 };
const END: MediaSlot = { id: "end", label: "End frame", hint: "The shot lands on this image.", accept: ["image"], min: 0, max: 1 };

const IMAGE_ASPECTS = ["1:1", "4:5", "3:4", "2:3", "9:16", "5:4", "4:3", "3:2", "16:9", "21:9"];

/* ---------------------------------- images ---------------------------------- */

const imageBase = { kind: "image" as const, status: "available" as const, surfaces: ["image"], prompt: IMAGE_PROMPT, output: "image" as const, provider: "kie" as const };

const nanoBanana = (id: string, model: string, name: string, tagline: string, maxRefs: number, extra: Partial<ModelDef> = {}): ModelDef => ({
  ...imageBase,
  id,
  name,
  vendor: "Google",
  tagline,
  slots: [refs(maxRefs)],
  controls: [aspect(IMAGE_ASPECTS, "1:1"), resolution(["1K", "2K", "4K"], "1K", "Size")],
  batch: { max: 4, native: false },
  eta: 25,
  build({ prompt, values, media }: BuildContext) {
    const images = (media.refs ?? []).map((r) => r.url);
    return {
      endpoint: kie(model),
      body: compact({ prompt, image_input: images.length ? images : undefined, aspect_ratio: values.aspect, resolution: values.resolution, output_format: "png" }),
    };
  },
  ...extra,
});

const gptImage2: ModelDef = {
  ...imageBase,
  id: "gpt-image-2",
  name: "GPT Image 2",
  vendor: "OpenAI",
  tagline: "Sharp text and faithful edits, at a low price.",
  badges: ["Text"],
  slots: [refs(16)],
  controls: [aspect(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"], "1:1"), resolution(["1K", "2K", "4K"], "1K", "Size")],
  batch: { max: 4, native: false },
  eta: 40,
  build({ prompt, values, media }) {
    const images = (media.refs ?? []).map((r) => r.url);
    const edit = images.length > 0;
    return {
      endpoint: kie(edit ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image"),
      body: compact({ prompt, input_urls: edit ? images : undefined, aspect_ratio: values.aspect, resolution: values.resolution }),
    };
  },
};

const fluxKlein: ModelDef = {
  ...imageBase,
  id: "flux-3-klein",
  name: "FLUX 3 Klein",
  vendor: "Black Forest Labs",
  tagline: "Very fast drafts at the lowest price.",
  badges: ["Budget"],
  slots: [],
  controls: [aspect(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"], "1:1"), resolution(["1K", "2K", "4K"], "1K", "Size")],
  batch: { max: 4, native: false },
  eta: 15,
  build({ prompt, values }) {
    return { endpoint: kie("flux-3/klein-text-to-image"), body: { prompt, aspect_ratio: values.aspect, resolution: values.resolution, output_format: "png", num_images: 1 } };
  },
};

const seedream55: ModelDef = {
  ...imageBase,
  id: "seedream-5.5",
  name: "Seedream 5.5",
  vendor: "ByteDance",
  tagline: "Polished product and design imagery.",
  slots: [],
  controls: [aspect(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"], "1:1"), select("resolution", "Size", ["1K", "1.5K", "2K"], "2K")],
  batch: { max: 4, native: false },
  eta: 30,
  build({ prompt, values }) {
    return { endpoint: kie("seedream/5-5-text-to-image"), body: { prompt, aspect_ratio: values.aspect, size: values.resolution, output_format: "png" } };
  },
};

/* ---------------------------------- video ---------------------------------- */

const videoBase = { kind: "video" as const, status: "available" as const, surfaces: ["video"], prompt: VIDEO_PROMPT, output: "video" as const, provider: "kie" as const };

function frames(media: Record<string, { url: string }[]>) {
  const first = media.start?.[0]?.url;
  // A last frame needs a first frame; on its own it is ignored.
  const last = first ? media.end?.[0]?.url : undefined;
  return { first, last };
}

const veo = (id: string, tier: "veo3" | "veo3_fast" | "veo3_lite", name: string, tagline: string, badges: string[], eta: number, featured = false): ModelDef => ({
  ...videoBase,
  id,
  name,
  vendor: "Google",
  tagline,
  badges,
  featured,
  slots: [START, END],
  controls: [
    aspect(["16:9", "9:16"], "16:9"),
    duration([4, 6, 8], 8),
    // 1080p is only offered with the 8 second length.
    select("resolution", "Resolution", [opt("720p"), opt("1080p", "1080p", { when: { duration: "8" } })], "720p"),
  ],
  batch: { max: 4, native: false },
  eta,
  build({ prompt, values, media }) {
    const { first, last } = frames(media);
    const images = [first, last].filter((u): u is string => Boolean(u));
    return {
      endpoint: kie("veo-3-1"),
      body: compact({
        prompt,
        model: tier,
        aspect_ratio: values.aspect,
        resolution: values.resolution,
        duration: Number(values.duration),
        generation_type: images.length ? "FIRST_AND_LAST_FRAMES_2_VIDEO" : "TEXT_2_VIDEO",
        image_urls: images.length ? images : undefined,
      }),
    };
  },
});

const kling = (id: string, mode: "std" | "pro", name: string, tagline: string, badges: string[], eta: number, featured = false): ModelDef => ({
  ...videoBase,
  id,
  name,
  vendor: "Kuaishou",
  tagline,
  badges,
  featured,
  slots: [START, END],
  controls: [aspect(["16:9", "9:16", "1:1"], "16:9"), duration({ min: 3, max: 15 }, 5), toggle("audio", "Sound", false, { hint: "Adds sound and costs more." })],
  batch: { max: 4, native: false },
  eta,
  build({ prompt, values, media }) {
    const { first, last } = frames(media);
    const images = [first, last].filter((u): u is string => Boolean(u));
    return {
      endpoint: kie("kling-3.0/video"),
      body: compact({
        prompt,
        image_urls: images.length ? images : undefined,
        sound: Boolean(values.audio),
        duration: String(values.duration),
        aspect_ratio: values.aspect,
        mode,
        multi_shots: false,
      }),
    };
  },
});

const seedance25: ModelDef = {
  ...videoBase,
  id: "seedance-2.5",
  name: "Seedance 2.5",
  vendor: "ByteDance",
  tagline: "Long, coherent takes with sound. Premium price.",
  badges: ["Sound", "Premium"],
  featured: true,
  prompt: { ...VIDEO_PROMPT, maxLength: 20000 },
  slots: [START, END],
  controls: [
    aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "16:9"),
    duration({ min: 4, max: 15 }, 5),
    resolution(["480p", "720p", "1080p"], "720p"),
    toggle("audio", "Sound", true, { hint: "Generate dialogue, effects and ambience with the picture." }),
  ],
  batch: { max: 4, native: false },
  eta: 120,
  build({ prompt, values, media }) {
    const { first, last } = frames(media);
    return {
      endpoint: kie("bytedance/seedance-2-5"),
      body: compact({
        prompt,
        first_frame_url: first,
        last_frame_url: last,
        resolution: values.resolution,
        aspect_ratio: values.aspect,
        duration: Number(values.duration),
        generate_audio: Boolean(values.audio),
      }),
    };
  },
};

const wan3: ModelDef = {
  ...videoBase,
  id: "wan-3",
  name: "Wan 3.0",
  vendor: "Alibaba",
  tagline: "Flexible lengths and a very low price per second.",
  badges: ["Budget"],
  prompt: { ...VIDEO_PROMPT, maxLength: 5000 },
  slots: [START, END],
  controls: [
    aspect(["16:9", "4:3", "1:1", "3:4", "9:16"], "16:9"),
    duration({ min: 2, max: 15 }, 5),
    resolution(["480P", "720P", "1080P"], "720P"),
    toggle("audio", "Sound", true, { hint: "Generate sound with the picture. The price is the same." }),
  ],
  batch: { max: 4, native: false },
  eta: 60,
  build({ prompt, values, media }) {
    const { first, last } = frames(media);
    return {
      endpoint: kie("wan/3-0-video"),
      body: compact({
        prompt,
        first_frame_url: first,
        last_frame_url: last,
        resolution: values.resolution,
        aspect_ratio: values.aspect,
        duration: Number(values.duration),
        audio: Boolean(values.audio),
      }),
    };
  },
};

const grok: ModelDef = {
  ...videoBase,
  id: "grok-imagine",
  name: "Grok Imagine",
  vendor: "xAI",
  tagline: "Fast clips with sound, from 6 to 30 seconds.",
  badges: ["Sound", "Budget"],
  prompt: { ...VIDEO_PROMPT, maxLength: 5000 },
  slots: [],
  controls: [aspect(["16:9", "9:16", "1:1", "3:2", "2:3"], "16:9"), duration({ min: 6, max: 30 }, 6), resolution(["480p", "720p", "1080p"], "720p")],
  batch: { max: 4, native: false },
  eta: 45,
  build({ prompt, values }) {
    return {
      endpoint: kie("grok-imagine/text-to-video"),
      body: { prompt, aspect_ratio: values.aspect, mode: "normal", duration: String(values.duration), resolution: values.resolution },
    };
  },
};

/* ---------------------------------- speech ---------------------------------- */

const speechBase = { kind: "audio" as const, status: "available" as const, surfaces: ["speech"], prompt: SCRIPT, slots: [], output: "audio" as const, provider: "kie" as const };

// Voice ids come from the live schema (GET /api/v1/models/<model>/schema).
const ELEVEN_VOICES: Option[] = [
  opt("pNInz6obpgDQGcFmaJgB", "Adam", { hint: "Dominant, firm" }),
  opt("Xb7hH8MSUJpSbSDYk0k2", "Alice", { hint: "Clear, engaging educator" }),
  opt("pqHfZKP75CvOlQylNhV4", "Bill", { hint: "Wise, mature" }),
  opt("IKne3meq5aSn9XLyUdCD", "Charlie", { hint: "Deep, confident" }),
  opt("iP95p4xoKVk53GoZ742B", "Chris", { hint: "Charming, down to earth" }),
  opt("onwK4e9ZLuTAKqWW03F9", "Daniel", { hint: "Steady broadcaster" }),
  opt("cjVigY5qzO86Huf0OWal", "Eric", { hint: "Smooth, trustworthy" }),
  opt("JBFqnCBsd6RMkjVDRZzb", "George", { hint: "Warm storyteller" }),
  opt("SOYHLrjzK2X1ezoPC6cr", "Harry", { hint: "Animated" }),
  opt("cgSgspJ2msm6clMCkdW9", "Jessica", { hint: "Playful, bright" }),
  opt("pFZP5JQG7iQjIQuC4Bku", "Lily", { hint: "Velvety actress" }),
  opt("XrExE9yKIg1WjnnlVkGX", "Matilda", { hint: "Knowledgeable" }),
  opt("SAz9YHcvj6GT2YYXdXww", "River", { hint: "Relaxed, neutral" }),
  opt("CwhRBWXzGAHq8TQ4Fs17", "Roger", { hint: "Laid-back, casual" }),
  opt("EXAVITQu4vr4xnSDxMaL", "Sarah", { hint: "Soft, reassuring" }),
  opt("bIHbv24MWmeRgasZH58o", "Will", { hint: "Relaxed optimist" }),
  opt("N2lVS1w4EtoT3dr4eOWO", "Callum", { hint: "Husky, engaging" }),
];

const elevenlabs: ModelDef = {
  ...speechBase,
  id: "elevenlabs-v2",
  name: "ElevenLabs Multilingual v2",
  vendor: "ElevenLabs",
  tagline: "Natural voices in many languages.",
  badges: ["Multilingual"],
  featured: true,
  controls: [
    select("voice", "Voice", ELEVEN_VOICES, "pNInz6obpgDQGcFmaJgB", { display: "menu" }),
    slider("stability", "Stability", 0, 1, 0.05, 0.5, { hint: "Lower is more expressive, higher is more even." }),
    slider("speed", "Speed", 0.7, 1.2, 0.05, 1, { unit: "x", advanced: true }),
  ],
  batch: { max: 1, native: false },
  eta: 10,
  build({ prompt, values }) {
    return {
      endpoint: kie("elevenlabs/text-to-speech-multilingual-v2"),
      body: { text: prompt, voice: values.voice, stability: Number(values.stability), similarity_boost: 0.75, speed: Number(values.speed) },
    };
  },
};

// Voice names from the model page, grouped there by use; the group is the hint.
const GEMINI_GROUPS: Record<string, string[]> = {
  Tutor: ["Bodi", "Lumi", "Sadaltager", "Sola", "Sulafat", "Varo", "Zephyr"],
  Voiceover: ["Koda", "Kore", "Nika", "Tavi", "Zeno"],
  Instructional: ["Algenib", "Despina", "Erinome", "Kira", "Ludo", "Mako", "Rasalgethi", "Rina"],
  Podcast: ["Alnilam", "Brio", "Jori", "Laomedeia", "Rami", "Veda"],
  Storyteller: ["Achird", "Enzo", "Riko", "Sami", "Zali", "Zubenelgenubi"],
  Assistant: ["Algieba", "Aoede", "Autonoe", "Callirrhoe", "Enceladus", "Gero", "Iapetus", "Neno", "Olin", "Tari", "Umbriel"],
  "Call center": ["Achernar", "Charon", "Daro", "Fola", "Hali", "Milo", "Puck"],
  Concierge: ["Arlo", "Cleo", "Fenrir", "Finn", "Leda", "Lora", "Orus"],
  "Tech support": ["Enya", "Jett", "Knox", "Nyla", "Sadachbia", "Vindemiatrix"],
  Professional: ["Cruz", "Elio", "Gacrux", "Pulcherrima", "Schedar", "Tova", "Zuri"],
};
const GEMINI_VOICES: Option[] = Object.entries(GEMINI_GROUPS).flatMap(([group, names]) => names.map((n) => opt(n, n, { hint: group })));

const geminiTts: ModelDef = {
  ...speechBase,
  id: "gemini-tts",
  name: "Gemini 3.8 Flash TTS",
  vendor: "Google",
  tagline: "Expressive speech. Add tags like <laugh> or <whisper>.",
  badges: ["Low cost"],
  prompt: { ...SCRIPT, maxLength: 10000 },
  controls: [select("voice", "Voice", GEMINI_VOICES, "Fola", { display: "menu" })],
  batch: { max: 1, native: false },
  eta: 8,
  build({ prompt, values }) {
    return {
      endpoint: kie("google/gemini-3-8-flash-tts"),
      body: { temperature: 1, speakers: [{ speaker_id: "Speaker 1", voice_name: values.voice }], dialogue_turns: [{ speaker_id: "Speaker 1", text: prompt }] },
    };
  },
};

/* ---------------------------------- music ---------------------------------- */

const suno: ModelDef = {
  kind: "music",
  id: "suno-v6",
  name: "Suno V6",
  vendor: "Suno",
  tagline: "Full songs with vocals or instrumentals. Two takes per request.",
  badges: ["Songs"],
  featured: true,
  status: "available",
  surfaces: ["music"],
  prompt: { required: true, maxLength: 3000, label: "Description", placeholder: "Describe the song: genre, mood, tempo, instruments, what it is about." },
  slots: [],
  controls: [
    toggle("instrumental", "Instrumental", false, { hint: "No singing." }),
    select("model", "Version", [opt("V6_MINI", "V6 Mini", { hint: "Fast" }), opt("V6", "V6", { hint: "Best quality" })], "V6_MINI", { advanced: true }),
  ] as Control[],
  // One request returns two takes, whatever the count; the price is for the request.
  batch: { max: 2, native: true },
  output: "audio",
  provider: "kie",
  eta: 45,
  build({ prompt, values }) {
    return { endpoint: kie("ai-music-api/generate"), body: { custom_mode: false, instrumental: Boolean(values.instrumental), model: values.model, prompt } };
  },
};

export const kieModels: ModelDef[] = [
  // image
  nanoBanana("nano-banana-pro", "nano-banana-pro", "Nano Banana Pro", "Google's best image model, up to 4K, with up to 8 references.", 8, { featured: true, badges: ["4K"], eta: 35 }),
  nanoBanana("nano-banana-2", "nano-banana-2", "Nano Banana 2", "Fast, good value, up to 4K.", 10, { badges: ["4K"], eta: 22 }),
  gptImage2,
  fluxKlein,
  seedream55,
  // video
  veo("veo-3.1", "veo3", "Veo 3.1", "Flagship realism with native sound.", ["Sound"], 150, true),
  veo("veo-3.1-fast", "veo3_fast", "Veo 3.1 Fast", "Most of Veo's look at a fraction of the price.", ["Sound"], 90),
  veo("veo-3.1-lite", "veo3_lite", "Veo 3.1 Lite", "The cheapest way to draft a shot with sound.", ["Budget", "Sound"], 45),
  seedance25,
  kling("kling-3-pro", "pro", "Kling 3.0 Pro", "Strong motion and character acting, 1080p.", ["1080p"], 90, true),
  kling("kling-3-std", "std", "Kling 3.0 Standard", "Kling motion at a lower price, 720p.", ["Budget"], 70),
  wan3,
  grok,
  // speech and music
  elevenlabs,
  geminiTts,
  suno,
];

/** The base-registry models these replace, by id. */
export const kieModelById = new Map(kieModels.map((m) => [m.id, m]));

