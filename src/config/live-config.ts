import { models } from "@/registry";
import { PLANS, PRICING } from "./economy";

/**
 * What an admin can change at run time: the margin, the exchange rate, the plans and which
 * models are switched off. The server applies it at start-up and after each edit, and sends it
 * with the session so the browser prices and lists things the same way. Shared by both sides.
 */

export interface LiveConfig {
  pricing: { margin: number; usdBrl: number };
  plans: Record<string, { name: string; priceUsd: number; monthlyCredits: number; concurrency: number }>;
  /** Models an admin switched off. They show as offline and cannot be run. */
  disabledModels: string[];
}

const original = new Map(models.map((m) => [m.id, { status: m.status, note: m.statusNote }]));
let disabled = new Set<string>();

export function applyConfig(cfg: Partial<LiveConfig> | null | undefined) {
  if (!cfg) return;
  if (cfg.pricing) {
    if (Number.isFinite(cfg.pricing.margin) && cfg.pricing.margin >= 1) PRICING.margin = cfg.pricing.margin;
    if (Number.isFinite(cfg.pricing.usdBrl) && cfg.pricing.usdBrl > 0) PRICING.usdBrl = cfg.pricing.usdBrl;
  }
  for (const [id, p] of Object.entries(cfg.plans ?? {})) {
    const plan = PLANS[id];
    if (!plan) continue;
    plan.name = p.name;
    plan.priceUsd = p.priceUsd;
    plan.monthlyCredits = p.monthlyCredits;
    plan.concurrency = p.concurrency;
  }
  if (cfg.disabledModels) {
    disabled = new Set(cfg.disabledModels);
    for (const m of models) {
      const o = original.get(m.id)!;
      if (disabled.has(m.id)) {
        m.status = "offline";
        m.statusNote = "Temporarily unavailable";
      } else {
        m.status = o.status;
        m.statusNote = o.note;
      }
    }
  }
}

export function currentConfig(): LiveConfig {
  return {
    pricing: { margin: PRICING.margin, usdBrl: PRICING.usdBrl },
    plans: Object.fromEntries(Object.values(PLANS).map((p) => [p.id, { name: p.name, priceUsd: p.priceUsd, monthlyCredits: p.monthlyCredits, concurrency: p.concurrency }])),
    disabledModels: [...disabled],
  };
}
