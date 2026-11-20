import { adminRoute, overview } from "@/server/admin";

/** GET /api/admin/overview   Headline numbers for the last 24 hours. Admins only. */
export const GET = adminRoute(() => overview());
