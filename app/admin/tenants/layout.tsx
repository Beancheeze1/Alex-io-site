// app/admin/tenants/layout.tsx
//
// Step 38E: platform owner only (Alex-IO → Shops). Shop admins who type
// this address go to their admin Home; the tenants API was already
// owner-only.

import { ReactNode } from "react";
import { requirePlatformOwner } from "@/lib/admin-page-guard";

export const dynamic = "force-dynamic";

export default async function TenantsLayout({ children }: { children: ReactNode }) {
  await requirePlatformOwner("/admin/tenants");
  return <>{children}</>;
}
