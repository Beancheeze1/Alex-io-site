// app/admin/settings/terms/page.tsx
//
// Step 38C: Shop settings → Quote terms & buyer emails. Quote validity and
// lead time, buyer status emails, reply-to, reminders and the staff digest.

import { requireSettingsAdmin } from "@/lib/admin-settings-guard";
import ShopSettingsEditor from "@/components/admin/ShopSettingsEditor";

export const dynamic = "force-dynamic";

export default async function TermsSettingsPage() {
  await requireSettingsAdmin("/admin/settings/terms");
  return <ShopSettingsEditor section="terms" />;
}
