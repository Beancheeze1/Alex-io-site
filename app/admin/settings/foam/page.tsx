// app/admin/settings/foam/page.tsx
//
// Step 38C: Pricing → Foam cutting rates (foam shops only). Default rates,
// markup, die-cutting charge, CNC / die / press / lamination costs, foam
// review checks and cushion family priority.

import { redirect } from "next/navigation";
import { requireSettingsAdmin } from "@/lib/admin-settings-guard";
import ShopSettingsEditor from "@/components/admin/ShopSettingsEditor";

export const dynamic = "force-dynamic";

export default async function FoamSettingsPage() {
  const { sellsFoam } = await requireSettingsAdmin("/admin/settings/foam");
  if (!sellsFoam) redirect("/admin/settings");
  return <ShopSettingsEditor section="foam" />;
}
