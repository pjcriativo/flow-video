import { adminRoute, listUsers } from "@/server/admin";
import { intParam } from "@/server/http";

/** GET /api/admin/users?q=&filter=all|members|guests|paid|suspended&limit=50   Admins only. */
export const GET = adminRoute(({ req }) => ({
  users: listUsers(
    (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80),
    intParam(req, "limit", 50, 1, 200),
    req.nextUrl.searchParams.get("filter") ?? "all",
  ),
}));
