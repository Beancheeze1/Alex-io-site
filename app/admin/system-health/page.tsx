// app/admin/system-health/page.tsx
//
// Step 38D: Alex-IO → System health (platform owner only). The Database,
// HubSpot and Email cards that used to sit on the admin Home.

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import SystemHealthCards from "@/components/admin/SystemHealthCards";

export const dynamic = "force-dynamic";

// Same platform owner allowlist as app/admin/layout.tsx.
const OWNER_EMAILS = new Set<string>(["25thhourdesign@gmail.com"]);

export default async function SystemHealthPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?next=/admin/system-health");
  const isOwner =
    String(user.role || "").toLowerCase() === "admin" && OWNER_EMAILS.has(String(user.email || "").trim().toLowerCase());
  if (!isOwner) redirect("/admin");

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <header className="mb-6 border-b border-[var(--border)] pb-5">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">System health</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Database, HubSpot and outbound email for the whole platform.</p>
        </header>
        <SystemHealthCards />
      </div>
    </main>
  );
}
