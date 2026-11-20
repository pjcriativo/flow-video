import { adminRoute, listAudit } from "@/server/admin";
import { intParam } from "@/server/http";

/** GET /api/admin/audit?limit=50   What admins changed, newest first. Admins only. */
export const GET = adminRoute(({ req }) => ({ entries: listAudit(intParam(req, "limit", 50, 1, 200)) }));
