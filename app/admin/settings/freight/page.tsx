// app/admin/settings/freight/page.tsx
//
// Step 38C: Pricing → Freight & shipping. Ship-from ZIP, freight terms and
// the rate table, plus the rough shipping % (moved here from the admin Home).

import { requireSettingsAdmin } from "@/lib/admin-settings-guard";
import ShopSettingsEditor from "@/components/admin/ShopSettingsEditor";
import RoughShippingCard from "@/components/admin/RoughShippingCard";

export const dynamic = "force-dynamic";

export default async function FreightSettingsPage() {
  await requireSettingsAdmin("/admin/settings/freight");
  return (
    <ShopSettingsEditor
      section="freight"
      after={
        <section data-rough-shipping>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Rough shipping estimate
          </h2>
          <div className="md:w-1/2">
            <RoughShippingCard />
          </div>
        </section>
      }
    />
  );
}
