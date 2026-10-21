// app/admin/team/page.tsx
//
// Step 38B: Team & users (menu: Shop settings → Team & users). The shop's
// users, invites, roles, referral names, commission % and the mileage
// rate, moved here from the admin Home. Admins only; cs and sales go back
// to Quotes (the users API is admin-only either way).

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import UsersAndRolesCard from "@/components/admin/UsersAndRolesCard";

export const dynamic = "force-dynamic";

// Same platform owner allowlist as app/admin/layout.tsx.
const OWNER_EMAILS = new Set<string>(["25thhourdesign@gmail.com"]);

export default async function TeamPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?next=/admin/team");
  const role = String(user.role || "").toLowerCase();
  if (role !== "admin") redirect("/admin/quotes");
  const isOwner = OWNER_EMAILS.has(String(user.email || "").trim().toLowerCase());

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <header className="mb-6 border-b border-[var(--border)] pb-5">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Team &amp; users</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            Invite your people and set what they can do. <strong>Admin</strong>: everything, including pricing,
            settings and releasing quotes. <strong>CS</strong>: all quotes, revise, proofs and shipping.{" "}
            <strong>Sales</strong>: their own quotes, plus a referral link that credits quotes to them.
          </p>
        </header>
        <section data-team-page>
          <UsersAndRolesCard isOwner={isOwner} />
        </section>
      </div>
    </main>
  );
}
