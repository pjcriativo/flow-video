import "server-only";

import fs from "node:fs";
import path from "node:path";
import { CREDIT_USD, PLANS, PRICING } from "@/config/economy";
import { currentConfig } from "@/config/live-config";
import { models } from "@/registry";
import { grantPlan } from "./account/subscription";
import { adminEmails, audit } from "./admin";
import { applyPlanOverrides, dataDir, get, run, tx } from "./db";
import { badRequest, notFound } from "./errors";
import { dailyBudgetUsd } from "./jobs";
import { KIE_USD_PER_CREDIT, kieBalance, kieKey } from "./kie";
import { clearSecret, deleteSetting, getSetting, secretInfo, setSecret, setSetting } from "./settings";
import { tregMode } from "./treg";

/** Admin: provider keys, margin, exchange rate, budget, per-model switches and manual plans. */

export const SECRETS = {
  treg_token: { label: "Gateway Treg (geração de imagem, vídeo e áudio)", env: "TREG_TOKEN", connected: true },
  kie_api_key: { label: "kie.ai (imagem, vídeo, voz e música)", env: "KIE_API_KEY", connected: true },
  higgsfield_api_key: { label: "Higgsfield", env: "HIGGSFIELD_API_KEY", connected: false },
} as const;
type SecretName = keyof typeof SECRETS;

/** The kie.ai balance, asked at most once a minute. */
const balanceCache = ((globalThis as unknown as { __kieBalance?: { at: number; value: { credits: number | null; error: string } } }).__kieBalance ??= { at: 0, value: { credits: null, error: "" } });

export async function kieAccount(force = false) {
  if (!kieKey()) return { configured: false, credits: null as number | null, usd: null as number | null, error: "" };
  if (force || Date.now() - balanceCache.at > 60_000) {
    try {
      balanceCache.value = { credits: await kieBalance(), error: "" };
    } catch (err) {
      balanceCache.value = { credits: null, error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" };
    }
    balanceCache.at = Date.now();
  }
  const { credits, error } = balanceCache.value;
  return { configured: true, credits, usd: credits === null ? null : Math.round(credits * KIE_USD_PER_CREDIT * 100) / 100, error };
}

export function systemInfo() {
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(path.join(dataDir(), "parallax.db")).size;
  } catch {
    /* no file yet */
  }
  return {
    mode: tregMode(),
    modeSetting: getSetting("treg_mode") ?? "",
    secrets: (Object.keys(SECRETS) as SecretName[]).map((name) => ({
      name,
      label: SECRETS[name].label,
      connected: SECRETS[name].connected,
      ...secretInfo(name, process.env[SECRETS[name].env] ?? ""),
    })),
    dailyBudgetUsd: dailyBudgetUsd(),
    agentMode: process.env.AGENT_MODE ?? "mock",
    demoBilling: process.env.PARALLAX_DEMO_BILLING ?? "(padrão)",
    cookieSecure: process.env.COOKIE_SECURE === "1",
    origin: process.env.PARALLAX_ORIGIN ?? "",
    admins: adminEmails(),
    creditUsd: CREDIT_USD,
    marginPct: Math.round((PRICING.margin - 1) * 1000) / 10,
    usdBrl: PRICING.usdBrl,
    dataDir: dataDir(),
    dbMegabytes: Math.round((dbBytes / 1_000_000) * 10) / 10,
    node: process.version,
    uptimeMinutes: Math.round(process.uptime() / 60),
  };
}

export function listModels() {
  const off = new Set(currentConfig().disabledModels);
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    kind: m.kind,
    surfaces: m.surfaces,
    badges: m.badges ?? [],
    provider: m.provider ?? "treg",
    status: m.status,
    enabled: !off.has(m.id),
  }));
}

export function setModelEnabled(adminId: string, modelId: unknown, enabled: unknown) {
  const id = String(modelId ?? "");
  if (!models.some((m) => m.id === id)) throw notFound("Esse modelo não existe.");
  const on = enabled === true;
  run(
    "INSERT INTO admin_model_overrides (model_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(model_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
    id,
    on ? 1 : 0,
    Date.now(),
  );
  applyPlanOverrides();
  audit(adminId, on ? "model.enable" : "model.disable", id, {});
  return { ok: true };
}

function number(v: unknown, label: string, min: number, max: number): number {
  const n = Number(v);
  if (v === "" || v === null || !Number.isFinite(n) || n < min || n > max) throw badRequest(`${label}: informe um valor entre ${min} e ${max}.`);
  return n;
}

/** Margin, exchange rate, daily budget and generation mode. */
export function updateSettings(adminId: string, b: Record<string, unknown>) {
  const changed: Record<string, unknown> = {};
  if (b.marginPct !== undefined) {
    // Typed as a percentage over cost: 40 means the price is the cost x 1.4.
    const pct = number(b.marginPct, "Margem (%)", 0, 900);
    setSetting("margin", String(1 + pct / 100));
    changed.marginPct = pct;
  }
  if (b.usdBrl !== undefined) {
    changed.usdBrl = number(b.usdBrl, "Cotação do dólar", 0.5, 100);
    setSetting("usd_brl", String(changed.usdBrl));
  }
  if (b.dailyBudgetUsd !== undefined) {
    changed.dailyBudgetUsd = number(b.dailyBudgetUsd, "Orçamento diário", 0, 100_000);
    setSetting("daily_budget_usd", String(changed.dailyBudgetUsd));
  }
  if (b.mode !== undefined) {
    const mode = String(b.mode);
    if (!["", "mock", "live"].includes(mode)) throw badRequest("Modo inválido.");
    if (mode === "live" && !secretInfo("treg_token", process.env.TREG_TOKEN ?? "").set) throw badRequest("Defina a chave do provedor antes de ligar o modo real.");
    if (mode) setSetting("treg_mode", mode);
    else deleteSetting("treg_mode");
    changed.mode = mode || "auto";
  }
  applyPlanOverrides();
  audit(adminId, "settings.update", null, changed);
  return { ok: true };
}

export function saveSecret(adminId: string, nameRaw: unknown, value: unknown) {
  const name = String(nameRaw ?? "");
  if (!(name in SECRETS)) throw badRequest("Chave desconhecida.");
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 8 || text.length > 500 || /\s/.test(text)) throw badRequest("A chave parece inválida (sem espaços, de 8 a 500 caracteres).");
  setSecret(name, text);
  audit(adminId, "secret.set", name, { last4: text.slice(-4) });
  return { ok: true };
}

export function removeSecret(adminId: string, nameRaw: unknown) {
  const name = String(nameRaw ?? "");
  if (!(name in SECRETS)) throw badRequest("Chave desconhecida.");
  clearSecret(name);
  audit(adminId, "secret.clear", name, {});
  return { ok: true };
}

/** Gives a member a plan without a payment (a gift, a trial or a manual sale). Free ends it. */
export function setUserPlan(adminId: string, userId: unknown, planId: unknown, months: unknown) {
  const id = String(userId ?? "");
  const plan = String(planId ?? "");
  const m = Math.floor(Number(months ?? 1));
  if (!PLANS[plan]) throw badRequest("Plano inválido.");
  if (plan !== "free" && (!Number.isFinite(m) || m < 1 || m > 24)) throw badRequest("A duração deve ser de 1 a 24 meses.");
  const u = get<{ is_guest: number }>("SELECT is_guest FROM users WHERE id = ?", id);
  if (!u) throw notFound("Essa conta não existe.");
  if (u.is_guest) throw badRequest("Visitantes não podem ter plano. A pessoa precisa criar uma conta.");
  tx(() => {
    grantPlan(id, plan, m);
    audit(adminId, "user.plan", id, { plan, months: plan === "free" ? 0 : m });
  });
  return { ok: true };
}
