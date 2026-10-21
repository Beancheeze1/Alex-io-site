// lib/admin-page-guard.ts
//
// Step 38E: server-side page guards for admin pages that are client
// components with no role check of their own. A cs or sales user who types
// one of these addresses goes back to Quotes instead of seeing an empty
// page with failed data (their data was always protected by the APIs).

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";

/** Shop admins only (cs / sales → Quotes, signed out → sign in). */
export async function requireShopAdmin(path: string): Promise<void> {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (String(user.role || "").toLowerCase() !== "admin") redirect("/admin/quotes");
}

/** The platform owner only (anyone else → their admin Home). */
export async function requirePlatformOwner(path: string): Promise<void> {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (String(user.role || "").toLowerCase() !== "admin" || !isPlatformOwner(user)) redirect("/admin");
}
