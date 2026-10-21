// app/admin/page.tsx
//
// Admin Home (tenant-aware title). Step 38D: loads "Needs you today" on the
// server for admins (cs and sales are sent to Quotes by AdminHomeClient).

import { headers } from "next/headers";
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
  const tenantId = user ? Number(user.tenant_id) : NaN;
  const types = user ? await tenantQuoteTypes(tenantId).catch(() => null) : null;
  const sellsFoam = types ? offersFoam(types) : true;
  const sellsBoxes = types ? types.includes("boxes_only") || types.includes("complete_pack") : true;

  // Step 38D: today's work, for admins only.
  const isAdmin = !!user && String(user.role || "").toLowerCase() === "admin";
  let today: AdminToday | null = null;
  if (isAdmin && Number.isInteger(tenantId) && tenantId > 0) {
    today = await loadAdminToday(tenantId).catch(() => null);
  }

  return <AdminHomeClient dashboardTitle={dashboardTitle} today={today} sellsFoam={sellsFoam} sellsBoxes={sellsBoxes} />;
}
