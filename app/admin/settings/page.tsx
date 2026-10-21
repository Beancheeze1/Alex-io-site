// app/admin/settings/page.tsx
//
// Step 38C: the single settings page was split into
//   /admin/settings/freight  (Pricing → Freight & shipping)
//   /admin/settings/foam     (Pricing → Foam cutting rates, foam shops only)
//   /admin/settings/terms    (Shop settings → Quote terms & buyer emails)
// This page lists them, and sends old #anchor links to the right one.

import { requireSettingsAdmin } from "@/lib/admin-settings-guard";
import SettingsIndex from "@/components/admin/SettingsIndex";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const { sellsFoam } = await requireSettingsAdmin("/admin/settings");
  return <SettingsIndex sellsFoam={sellsFoam} />;
}
