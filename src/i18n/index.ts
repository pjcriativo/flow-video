import { PRICING } from "@/config/economy";
import * as account from "@/content/account";
import * as entry from "@/content/entry";
import * as pricing from "@/content/pricing";
import * as shell from "@/content/shell";
import { ptAccount } from "./pt/account";
import { ptEntry } from "./pt/entry";
import { ptPlanText } from "./pt/plans";
import { ptPricing } from "./pt/pricing";
import { ptShell } from "./pt/shell";

/**
 * Languages. The English words live in `src/content/*.ts`; each file has a Portuguese twin in
 * `src/i18n/pt/`. Switching language copies the Portuguese words over the English ones in place
 * (and back), so no component has to change: the app then draws itself again.
 *
 * To translate another content file: add `src/i18n/pt/<name>.ts` and one line in `MODULES`.
 */

export type Locale = "en" | "pt";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "pt", label: "Português" },
];

type Plain = Record<string, unknown>;
const MODULES: Record<string, { en: Plain; pt: Plain }> = {
  shell: { en: shell as unknown as Plain, pt: ptShell },
  entry: { en: entry as unknown as Plain, pt: ptEntry },
  pricing: { en: pricing as unknown as Plain, pt: ptPricing },
  account: { en: account as unknown as Plain, pt: ptAccount },
};

const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
}

/** Writes `source` over `target`, key by key, keeping everything `source` does not mention. */
function overlay(target: Plain, source: Plain) {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isPlain(value) && isPlain(current)) overlay(current, value);
    else if (Array.isArray(value) && Array.isArray(current)) {
      value.forEach((item, i) => {
        if (isPlain(item) && isPlain(current[i])) overlay(current[i] as Plain, item);
        else current[i] = item;
      });
      current.length = value.length;
    } else target[key] = value;
  }
}

/** The English words, copied before the first switch so they can be put back. */
let english: Record<string, Plain> | null = null;

function words(l: Locale) {
  if (!english) {
    english = {};
    for (const [name, m] of Object.entries(MODULES)) {
      english[name] = {};
      for (const key of Object.keys(m.pt)) english[name][key] = clone((m.en as Plain)[key]);
    }
  }
  for (const [name, m] of Object.entries(MODULES)) {
    for (const key of Object.keys(m.pt)) {
      const target = (m.en as Plain)[key];
      if (!isPlain(target)) continue;
      overlay(target, english[name][key] as Plain); // back to English first
      if (l === "pt") overlay(target, m.pt[key] as Plain);
    }
  }
}

/* --------------------------------- state ---------------------------------- */

const COOKIE = "px_lang";
let current: Locale = "en";
let version = 0;
const listeners = new Set<() => void>();

export const getLocale = () => current;
export const getVersion = () => version;
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Switches the whole app. `remember` keeps the choice for next time. */
export function setLocale(l: Locale, remember = true) {
  if (l === current) return;
  words(l);
  current = l;
  version++;
  if (typeof document !== "undefined") {
    document.documentElement.lang = l === "pt" ? "pt-BR" : "en";
    if (remember) document.cookie = `${COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  }
  listeners.forEach((fn) => fn());
}

/** On first load: the saved choice, else the browser's language. */
export function initLocale() {
  if (typeof document === "undefined") return;
  const saved = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=(en|pt)`))?.[1] as Locale | undefined;
  const guess: Locale = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
  setLocale(saved ?? guess, false);
}

/* --------------------------------- money ---------------------------------- */

/**
 * Plans are defined in US dollars. In Portuguese the amount is converted to reais with the
 * rate the admin set, so the price shown is the price in the member's currency.
 */
export function formatMoneyCents(cents: number, { trimZeros = false }: { trimZeros?: boolean } = {}): string {
  if (current === "pt") {
    const brl = (cents / 100) * PRICING.usdBrl;
    const whole = trimZeros && Math.abs(brl - Math.round(brl)) < 0.005;
    return brl.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  }
  const whole = trimZeros && cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

export const dateLocale = () => (current === "pt" ? "pt-BR" : "en-US");

/** A plan card with its wording in the current language. Numbers are never touched. */
export function localizePlan<T extends { id: string; tagline: string; features: string[]; highlight: string | null }>(plan: T): T {
  const text = current === "pt" ? ptPlanText[plan.id] : undefined;
  return text ? { ...plan, tagline: text.tagline, features: text.features, highlight: text.highlight } : plan;
}
