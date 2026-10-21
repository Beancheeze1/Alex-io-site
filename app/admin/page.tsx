// app/admin/page.tsx
//
// Admin home dashboard (tenant-aware title).

import { headers } from "next/headers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { tenantQuoteTypes } from "@/lib/quote-types-server";
import { offersFoam } from "@/lib/quote-types";
import AdminHomeClient from "./AdminHomeClient";

// Step 38A2: same owner allowlist as app/admin/layout.tsx (owner-only cards).
const OWNER_EMAILS = new Set<string>(["25thhourdesign@gmail.com"]);

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

  // Step 38A2: what the shop sells (foam / box cards) and whether this is the
  // platform owner (System Health).
  const user = await getCurrentUserFromCookies().catch(() => null);
  const types = user ? await tenantQuoteTypes(Number(user.tenant_id)).catch(() => null) : null;
  const sellsFoam = types ? offersFoam(types) : true;
  const sellsBoxes = types ? types.includes("boxes_only") || types.includes("complete_pack") : true;
  const isOwner =
    !!user && String(user.role || "").toLowerCase() === "admin" && OWNER_EMAILS.has(String(user.email || "").trim().toLowerCase());

  return (
    <AdminHomeClient
      dashboardTitle={dashboardTitle}
      tenantSlug={tenantSlug}
      landingChatEnabled={landingChatEnabled}
      sellsFoam={sellsFoam}
      sellsBoxes={sellsBoxes}
      isOwner={isOwner}
    />
  );
}
