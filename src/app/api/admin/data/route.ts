import { adminRoute, listCoupons, listPlans, listReports } from "@/server/admin";
import { listModels, systemInfo } from "@/server/admin-config";
import { notFound } from "@/server/errors";

/** GET /api/admin/data?section=plans|coupons|reports|models|system[&status=open]   Admins only. */
export const GET = adminRoute(({ req }) => {
  const q = req.nextUrl.searchParams;
  switch (q.get("section")) {
    case "plans":
      return { plans: listPlans() };
    case "coupons":
      return { coupons: listCoupons() };
    case "reports":
      return { reports: listReports(q.get("status") ?? "open") };
    case "models":
      return { models: listModels() };
    case "system":
      return systemInfo();
    default:
      throw notFound();
  }
});
