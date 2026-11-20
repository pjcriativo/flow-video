import "server-only";

import { getSecret } from "./settings";

/**
 * The only file that talks to kie.ai. What was learned from real calls (2026-11-20):
 *
 *  - Errors come back as HTTP 200 with a `code` in the body. 200 means success, 401 a bad key or
 *    a blocked IP, 402 no credits, 422 a bad request, 429 too many requests, 455 maintenance.
 *  - There is no idempotency key. Sending a request twice makes two tasks and charges twice, so
 *    nothing here ever sends again on its own after an answer may have been lost.
 *  - `recordInfo` gives the task state, `resultJson` (a JSON string) and `creditsConsumed`.
 *  - Files we upload are deleted after 24 hours. Results are kept 14 days.
 *  - 20 new tasks per 10 seconds per account; past that the request is refused, not queued.
 */

const base = () => (process.env.KIE_API_BASE ?? "https://api.kie.ai").replace(/\/+$/, "");
const uploadBase = () => (process.env.KIE_UPLOAD_BASE ?? "https://kieai.redpandaai.co").replace(/\/+$/, "");

/** The key saved in the admin panel wins over the environment. */
export const kieKey = () => (getSecret("kie_api_key") || process.env.KIE_API_KEY || "").trim();

/** US dollars per kie credit, as the price list states it. */
export const KIE_USD_PER_CREDIT = 0.005;

export type KieFailure =
  | "auth" // bad key, or this server's IP is not allowed
  | "balance" // no credits left
  | "invalid" // the request itself was refused
  | "limit" // too many requests: try again in a moment
  | "retry" // the service is busy or in maintenance
  | "ambiguous" // no answer: the task may exist, so it must not be sent again
  | "unreachable" // never reached the service: safe to send again
  | "failed";

export class KieError extends Error {
  constructor(
    message: string,
    public kind: KieFailure,
    public code = 0,
  ) {
    super(message);
  }
}

function redact(text: string): string {
  const k = kieKey();
  return k ? text.split(k).join("[key]") : text;
}

/** Errors from `fetch` that prove the request never left this machine. */
const NEVER_SENT = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

async function send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? "";
    if (NEVER_SENT.has(cause)) throw new KieError("kie.ai could not be reached", "unreachable");
    throw new KieError("kie.ai did not answer", "ambiguous");
  }
}

interface Envelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

async function api(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<Envelope> {
  const key = kieKey();
  if (!key) throw new KieError("The kie.ai key is not set", "auth", 401);
  const res = await send(
    base() + path,
    {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "error",
    },
    timeoutMs,
  );
  let json: Envelope | null = null;
  try {
    json = (await res.json()) as Envelope;
  } catch {
    /* not JSON */
  }
  // Gateways in front of the API answer with real HTTP errors; the API itself uses `code`.
  if (!json) throw new KieError(`kie.ai answered ${res.status}`, res.status >= 500 ? "retry" : "failed", res.status);
  return json;
}

/** Maps a non-200 `code` to what the worker should do about it. */
function failureFor(code: number, msg: string): KieError {
  const text = redact(msg || `kie.ai code ${code}`);
  if (code === 401) return new KieError(text, "auth", code);
  if (code === 402) return new KieError(text, "balance", code);
  if (code === 422 || code === 400 || code === 404) return new KieError(text, "invalid", code);
  if (code === 429) return new KieError(text, "limit", code);
  if (code === 455 || code === 500 || code === 502 || code === 503 || code === 504) return new KieError(text, "retry", code);
  return new KieError(text, "failed", code);
}

/* --------------------------------- throttle --------------------------------- */

const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 18; // the limit is 20 per 10 seconds; keep two in hand
const sent: number[] = ((globalThis as unknown as { __kieSent?: number[] }).__kieSent ??= []);

/** Waits until one more task may be created without passing kie.ai's limit. */
export async function kieSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (sent.length && sent[0] <= now - WINDOW_MS) sent.shift();
    if (sent.length < MAX_PER_WINDOW) {
      sent.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(100, sent[0] + WINDOW_MS - now)));
  }
}

/* ---------------------------------- tasks ---------------------------------- */

export interface KieCreated {
  taskId: string;
}

/** Creates a task. Throws a `KieError` whose `kind` says whether sending again is safe. */
export async function kieCreate(model: string, input: unknown, callBackUrl?: string): Promise<KieCreated> {
  const env = await api("POST", "/api/v1/jobs/createTask", { model, input, ...(callBackUrl ? { callBackUrl } : {}) });
  if (env.code !== 200) throw failureFor(Number(env.code), String(env.msg ?? ""));
  const taskId = (env.data as { taskId?: unknown } | undefined)?.taskId;
  if (typeof taskId !== "string" || !taskId) throw new KieError("kie.ai did not return a task id", "ambiguous");
  return { taskId };
}

export interface KieTask {
  state: "running" | "success" | "failed";
  /** Direct links to the result files, in order. */
  urls: string[];
  /** What kie.ai charged for this task, in credits. */
  credits: number | null;
  message: string;
}

/** Result links: `resultUrls` for most models, or a list of tracks for Suno. */
export function resultUrls(resultJson: unknown): string[] {
  let parsed: unknown = resultJson;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const o = parsed as { resultUrls?: unknown; data?: unknown };
  if (Array.isArray(o.resultUrls)) return o.resultUrls.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  // Suno: { data: [{ audio_url, stream_audio_url, image_url, ... }] }. Only the full track counts.
  if (Array.isArray(o.data)) return o.data.map((t) => (t as { audio_url?: unknown })?.audio_url).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  return [];
}

export async function kieStatus(taskId: string): Promise<KieTask> {
  const env = await api("GET", `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  if (env.code !== 200) throw failureFor(Number(env.code), String(env.msg ?? ""));
  const d = (env.data ?? {}) as { state?: string; resultJson?: unknown; response?: unknown; creditsConsumed?: unknown; failMsg?: unknown; failCode?: unknown };
  const credits = Number(d.creditsConsumed);
  if (d.state === "success") {
    return { state: "success", urls: resultUrls(d.resultJson || d.response), credits: Number.isFinite(credits) ? credits : null, message: "" };
  }
  if (d.state === "fail") {
    return { state: "failed", urls: [], credits: Number.isFinite(credits) ? credits : null, message: redact(String(d.failMsg ?? d.failCode ?? "The model could not finish this one.")).slice(0, 300) };
  }
  return { state: "running", urls: [], credits: null, message: "" };
}

/* ----------------------------------- files ---------------------------------- */

/** Uploads a file kie.ai can fetch for the next 24 hours. Free. Returns the link and its expiry. */
export async function kieUpload(bytes: Buffer, mime: string, fileName: string): Promise<{ url: string; expiresAt: number }> {
  const key = kieKey();
  if (!key) throw new KieError("The kie.ai key is not set", "auth", 401);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
  form.append("uploadPath", "parallax");
  form.append("fileName", fileName);
  const res = await send(`${uploadBase()}/api/file-stream-upload`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, redirect: "error" }, 120_000);
  let json: { code?: number; msg?: string; data?: { downloadUrl?: string } } | null = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  const url = json?.data?.downloadUrl;
  if (!url || json?.code !== 200) throw failureFor(Number(json?.code ?? res.status), String(json?.msg ?? ""));
  // Deleted 24 hours after upload; stop using the link an hour early.
  return { url, expiresAt: Date.now() + 23 * 3_600_000 };
}

/* ----------------------------------- account -------------------------------- */

/** Credits left on the kie.ai account. */
export async function kieBalance(): Promise<number> {
  const env = await api("GET", "/api/v1/chat/credit", undefined, 15_000);
  if (env.code !== 200) throw failureFor(Number(env.code), String(env.msg ?? ""));
  const n = Number(env.data);
  if (!Number.isFinite(n)) throw new KieError("kie.ai returned an unreadable balance", "failed");
  return n;
}

/** Plain words for a member. The detail stays in the log and the admin panel. */
export function kieMemberMessage(err: KieError): string {
  switch (err.kind) {
    case "auth":
    case "balance":
      return "Generation is paused for a moment. Try again shortly.";
    case "limit":
    case "retry":
      return "The model is busy. Try again shortly.";
    case "invalid":
      return "These settings are not accepted by the model. Change them and try again.";
    default:
      return "The model could not make this one. Try again.";
  }
}
