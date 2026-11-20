import { adminRoute, userDetail } from "@/server/admin";

/** GET /api/admin/users/:id   One account in detail: balance, plan, recent jobs and ledger. Admins only. */
export const GET = adminRoute<{ id: string }>(({ params }) => userDetail(params.id));
