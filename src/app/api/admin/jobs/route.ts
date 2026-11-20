import { adminRoute, listJobs } from "@/server/admin";
import { intParam } from "@/server/http";

/** GET /api/admin/jobs?status=all|queued|running|succeeded|failed&limit=50   Admins only. */
export const GET = adminRoute(({ req }) => ({
  jobs: listJobs(intParam(req, "limit", 50, 1, 200), req.nextUrl.searchParams.get("status") ?? "all"),
}));
