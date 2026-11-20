import "server-only";

import { kieKey } from "./kie";
import { tregKeySet, tregMode } from "./treg";

export type ProviderId = "treg" | "kie";

/** Whether a provider can be called: it has a key. In test mode nothing is called, so all are ready. */
export function providerReady(provider: ProviderId): boolean {
  if (tregMode() === "mock") return true;
  return provider === "kie" ? Boolean(kieKey()) : tregKeySet();
}

/** Providers that cannot be called right now. Their models show as offline. */
export function providersOff(): ProviderId[] {
  return (["treg", "kie"] as const).filter((p) => !providerReady(p));
}
