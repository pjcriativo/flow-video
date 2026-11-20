"use client";

import { CREDIT_USD, formatCredits } from "@/config/economy";
import { formatMoneyCents, getLocale } from "@/i18n";
import type { Studio } from "@/lib/studio";

/**
 * What this press of Generate will cost, in credits and in money, before anything is spent.
 * The money is what the credits are worth to the member: US dollars in English, reais in
 * Portuguese at the admin's rate. The same quote the server will hold, so the two never differ.
 */
export function PriceLine({ studio }: { studio: Studio }) {
  const q = studio.quote;
  if (!q || !q.exact) return null;
  const pt = getLocale() === "pt";
  const credits = formatCredits(q.millicredits);
  const money = formatMoneyCents(Math.round((q.millicredits / 1000) * CREDIT_USD * 100));
  const batch = q.jobs > 1 ? (pt ? ` (${q.jobs} gerações)` : ` (${q.jobs} generations)`) : "";
  return (
    <p className="px-1 text-xs leading-4 text-text-secondary" data-testid="price-line">
      {pt ? "Custo" : "Cost"}: <span className="font-medium text-text-primary tabular-nums">{money}</span>
      <span className="tabular-nums">
        {" "}
        · {credits} {pt ? "créditos" : "credits"}
      </span>
      {batch}
    </p>
  );
}
