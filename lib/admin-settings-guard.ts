// lib/admin-settings-guard.ts
//
// Step 38C: shared guard for the split settings pages (/admin/settings/*).
// Admins only (cs and sales go to Quotes; the settings API is admin-only
// either way), plus what the shop sells so foam-only pages can be hidden.

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { tenantQuoteTypes } from "@/lib/quote-types-server";
import { offersFoam } from "@/lib/quote-types";

export async function requireSettingsAdmin(path: string): Promise<{ sellsFoam: boolean }> {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  const role = String(user.role || "").toLowerCase();
  if (role !== "admin") redirect("/admin/quotes");
  const types = await tenantQuoteTypes(Number(user.tenant_id)).catch(() => null);
  return { sellsFoam: types ? offersFoam(types) : true };
}
