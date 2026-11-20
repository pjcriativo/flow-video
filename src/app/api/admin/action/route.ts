import { adjustCredits, adminRoute, createCoupon, resolveReport, setSuspended, toggleCoupon, updatePlan } from "@/server/admin";
import { removeSecret, saveSecret, setModelEnabled, setUserPlan, updateSettings } from "@/server/admin-config";
import { badRequest } from "@/server/errors";
import { readJson } from "@/server/http";

/** POST /api/admin/action  { action, ... }   Every change an admin can make. Admins only. */
export const POST = adminRoute(async ({ req, admin }) => {
  const b = await readJson(req);
  switch (b.action) {
    case "credits.adjust":
      return adjustCredits(admin.id, String(b.userId ?? ""), b.credits, b.note);
    case "user.suspend":
      return setSuspended(admin.id, String(b.userId ?? ""), b.suspended, b.reason);
    case "user.plan":
      return setUserPlan(admin.id, b.userId, b.planId, b.months);
    case "plan.update":
      return updatePlan(admin.id, b);
    case "coupon.create":
      return createCoupon(admin.id, b);
    case "coupon.toggle":
      return toggleCoupon(admin.id, b.code, b.active);
    case "report.resolve":
      return resolveReport(admin.id, b.reportId, b.decision);
    case "model.toggle":
      return setModelEnabled(admin.id, b.modelId, b.enabled);
    case "settings.update":
      return updateSettings(admin.id, b);
    case "secret.set":
      return saveSecret(admin.id, b.name, b.value);
    case "secret.clear":
      return removeSecret(admin.id, b.name);
    default:
      throw badRequest("Ação desconhecida.");
  }
});
