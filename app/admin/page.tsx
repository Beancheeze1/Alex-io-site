// app/admin/page.tsx
//
// Admin Home (tenant-aware title). Step 38D: loads "Needs you today" on the
// server. Step 38E: admins and cs get Home (cs: her queue and the quote
// shortcuts); sales go to My quotes. This server check replaces the old
// client-side guard (which called /api/admin/users and could bounce an
// admin to Quotes on a slow or failed check).

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenantFromHost } from "@/lib/tenant";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { tenantQuoteTypes } from "@/lib/quote-types-server";
import { offersFoam } from "@/lib/quote-types";
import { loadAdminToday, type AdminToday } from "@/app/lib/admin-today";
import AdminHomeClient from "./AdminHomeClient";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  let dashboardTitle = "Alex-IO Admin";

  try {
    const h = await headers();
    const host = h.get("host");
    const tenant = await resolveTenantFromHost(host);

    if (tenant) {
      const brandName =
        typeof tenant.theme_json?.brandName === "string"
          ? tenant.theme_json.brandName.trim()
          : "";

      const name = (brandName || tenant.name || tenant.slug || "Tenant").trim();
      dashboardTitle = `${name} Admin`;
    }
  } catch {
    dashboardTitle = "Alex-IO Admin";
  }

  // Step 38A2: what the shop sells (foam / box cards).
  const user = await getCurrentUserFromCookies().catch(() => null);
  if (!user) redirect("/login?next=/admin");
  const role = String(user.role || "").toLowerCase();
  if (role !== "admin" && role !== "cs") redirect("/admin/quotes");
  const tenantId = Number(user.tenant_id);
  const types = await tenantQuoteTypes(tenantId).catch(() => null);
  const sellsFoam = types ? offersFoam(types) : true;
  const sellsBoxes = types ? types.includes("boxes_only") || types.includes("complete_pack") : true;

  // Step 38D: today's work (Step 38E: for cs too).
  let today: AdminToday | null = null;
  if (Number.isInteger(tenantId) && tenantId > 0) {
    today = await loadAdminToday(tenantId).catch(() => null);
  }

  return (
    <AdminHomeClient
      dashboardTitle={dashboardTitle}
      today={today}
      sellsFoam={sellsFoam}
      sellsBoxes={sellsBoxes}
      isAdmin={role === "admin"}
    />
  );
}
