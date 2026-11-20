import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, get, run } from "./db";

/**
 * Settings an admin edits from the panel. Plain values are stored as they are. Secrets (API
 * keys) are encrypted with AES-256-GCM. The key comes from PARALLAX_SECRET, or from a file
 * the app creates in the data folder, so a copy of the database alone does not reveal them.
 */

export function getSetting(key: string): string | null {
  return get<{ value: string }>("SELECT value FROM admin_settings WHERE key = ?", key)?.value ?? null;
}

export function setSetting(key: string, value: string) {
  run("INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", key, value, Date.now());
}

export function deleteSetting(key: string) {
  run("DELETE FROM admin_settings WHERE key = ?", key);
}

export function numberSetting(key: string): number | null {
  const raw = getSetting(key);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------- secrets --------------------------------- */

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.PARALLAX_SECRET?.trim();
  if (fromEnv) return (cachedKey = createHash("sha256").update(fromEnv).digest());
  const file = path.join(dataDir(), "secret.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return (cachedKey = createHash("sha256").update(fs.readFileSync(file, "utf8").trim()).digest());
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function open(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) return "";
  try {
    const d = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
  } catch {
    return ""; // a different key, or damaged data
  }
}

const secretKey = (name: string) => `secret:${name}`;

/** The saved secret, or "" when there is none. */
export function getSecret(name: string): string {
  const stored = getSetting(secretKey(name));
  return stored ? open(stored) : "";
}

export function setSecret(name: string, value: string) {
  setSetting(secretKey(name), seal(value.trim()));
}

export function clearSecret(name: string) {
  deleteSetting(secretKey(name));
}

/** What the panel may show about a secret: whether it is set, where from, and its last four characters. */
export function secretInfo(name: string, envValue = ""): { set: boolean; source: "panel" | "env" | "none"; last4: string } {
  const saved = getSecret(name);
  const value = saved || envValue.trim();
  return { set: Boolean(value), source: saved ? "panel" : envValue.trim() ? "env" : "none", last4: value ? value.slice(-4) : "" };
}
