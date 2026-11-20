import type { Metadata } from "next";
import { AdminPanel } from "@/components/admin/admin-panel";

export const metadata: Metadata = { title: "Admin" };

/** The page itself holds nothing private: every number comes from /api/admin/*, which answers 404 to anyone who is not an admin. */
export default function Admin() {
  return <AdminPanel />;
}
