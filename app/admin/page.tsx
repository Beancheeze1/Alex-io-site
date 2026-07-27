// app/admin/page.tsx
//
// Admin home dashboard (tenant-aware title).

import { headers } from "next/headers";
import { resolveTenantFromHost } from "@/lib/tenant";
import AdminHomeClient from "./AdminHomeClient";

export default async function AdminHomePage() {
  let dashboardTitle = "Alex-IO Admin";
  let tenantSlug: string | null = null;
  let landingChatEnabled = false;

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
      tenantSlug = tenant.slug;
      landingChatEnabled = tenant.theme_json?.landingChatEnabled === true;
    }
  } catch {
    dashboardTitle = "Alex-IO Admin";
  }

  return (
    <AdminHomeClient
      dashboardTitle={dashboardTitle}
      tenantSlug={tenantSlug}
      landingChatEnabled={landingChatEnabled}
    />
  );
}
