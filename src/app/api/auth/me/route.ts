import { syncSubscription } from "@/server/account/subscription";
import { applyConfig, currentConfig } from "@/config/live-config";
import { publicUser, userById } from "@/server/auth";
import { balance } from "@/server/credits";
import { publicRoute } from "@/server/http";
import { providersOff } from "@/server/providers";

/**
 * Who is signed in, and what they have to spend. `user` is null when signed out.
 * Every page asks this first, so it is also where a plan that renewed while the member
 * was away catches up: the new period and its credits show at once.
 */
export const GET = publicRoute(({ user }) => {
  // Which providers have a key can change from the admin panel, so it is read on every call.
  applyConfig({ providersOff: providersOff() });
  const config = currentConfig();
  if (!user) return { user: null, balance: 0, config };
  if (!user.isGuest) syncSubscription(user.id);
  return { user: publicUser(userById(user.id) ?? user), balance: balance(user.id), config };
});
