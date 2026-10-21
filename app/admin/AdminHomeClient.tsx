// app/admin/AdminHomeClient.tsx
//
// Admin Home. Step 38D: opens on the shop's work, not on system status:
//   - "Finish setting up your shop" until the Get started checklist is done
//   - Needs you today: review queue counts, new spec requests, latest quotes
//     (loaded on the server, app/lib/admin-today.ts)
//   - Shortcuts (only what the shop sells)
// Moved off Home: System health → owner menu (/admin/system-health),
// embed snippet → Shop settings → Website & chat widget (/admin/website).

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TodayPanel from "@/components/admin/TodayPanel";
import type { AdminToday } from "@/app/lib/admin-today";

type AdminHomeClientProps = {
  dashboardTitle: string;
  /** Step 38D: what needs the admin today (null if it couldn't be loaded). */
  today: AdminToday | null;
  /** Step 38A2: foam cards only for foam shops, corrugated for box shops. */
  sellsFoam?: boolean;
  sellsBoxes?: boolean;
};

export default function AdminHomeClient({ dashboardTitle, today, sellsFoam = true, sellsBoxes = true }: AdminHomeClientProps) {
  const router = useRouter();

  // Guard: only admins should see the /admin dashboard.
  // Sales/CS can still use /admin/quotes, but should not land on this hub.
  React.useEffect(() => {
    let active = true;

    async function checkAdmin() {
      try {
        const res = await fetch("/api/admin/users?limit=1", { cache: "no-store" });

        // /api/admin/users is admin-only. If we get 401/403, this user is not admin.
        if (!active) return;
        if (res.status === 401 || res.status === 403) {
          router.replace("/admin/quotes");
        }
      } catch {
        // If the check fails (network/etc), do nothing (avoid locking admin out).
      }
    }

    checkAdmin();

    return () => {
      active = false;
    };
  }, [router]);

  // Step 38D: old Home anchors (bookmarks, earlier links) go to the pages
  // those sections moved to.
  React.useEffect(() => {
    const to: Record<string, string> = {
      widget: "/admin/website",
      shipping: "/admin/settings/freight",
      team: "/admin/team",
    };
    const dest = to[window.location.hash.slice(1)];
    if (dest) router.replace(dest);
  }, [router]);

  // Step 36A: "Finish setting up" banner until the Get started checklist is complete.
  const [setup, setSetup] = React.useState<{ done: number; total: number } | null>(null);
  React.useEffect(() => {
    let active = true;
    fetch("/api/admin/onboarding", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.ok && j.checklist && !j.checklist.complete) setSetup({ done: Number(j.checklist.done), total: Number(j.checklist.total) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-8 border-b border-[var(--border)] pb-6">
          <h1 className="text-3xl font-medium tracking-tight text-[var(--text-primary)]">
            {dashboardTitle}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            What needs you today, and the shortcuts you use most.
          </p>
        </header>

        {setup ? (
          <Link
            href="/admin/get-started"
            className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--action-primary)] bg-[var(--surface-card)] px-4 py-3 text-sm"
            data-setup-banner
          >
            <span className="font-medium text-[var(--text-primary)]">Finish setting up your shop</span>
            <span className="text-[var(--text-secondary)]">
              {setup.done} of {setup.total} done
            </span>
            <span className="ml-auto font-medium text-[var(--action-primary)]">Get started →</span>
          </Link>
        ) : null}

        {today ? <TodayPanel today={today} /> : null}

        {/* Main navigation tiles */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Shortcuts
          </h2>

          {/* Step 38A2: only what this shop sells; same names as the menu */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <NavCard
              href="/admin/quotes"
              title="Quotes"
              description="Every quote: status, buyer, totals. Open one to revise, release or print the job ticket."
            />
            <NavCard
              href="/admin/review"
              title="Review queue"
              description="New quotes, accepted orders waiting for you to confirm, proofs and price changes."
            />
            {sellsBoxes ? (
              <NavCard
                href="/admin/corrugated"
                title="Corrugated boxes"
                description="Board grades and $/MSF, run and print rates, box styles, scoring and a price check."
              />
            ) : null}
            {sellsFoam ? (
              <NavCard
                href="/admin/materials"
                title="Foam materials"
                description="Your price per cubic inch, minimum charge and waste for each foam."
              />
            ) : null}
            {sellsFoam ? (
              <NavCard
                href="/admin/cushion-curves"
                title="Cushion curves"
                description="Cushion data behind the foam advisor's recommendations."
              />
            ) : null}
            {sellsFoam ? (
              <NavCard
                href="/admin/boxes"
                title="Stock cartons"
                description="Stock carton sizes and price tiers offered with foam quotes."
              />
            ) : null}
            <NavCard
              href="/admin/settings/freight"
              title="Freight & shipping"
              description="Ship-from ZIP, freight terms and the rate table used on every quote."
            />
            <NavCard
              href="/admin/website"
              title="Website & chat widget"
              description="Your shop page link and the snippets that put the quote form or chat on your own website."
            />
            <NavCard
              href="/admin/commissions"
              title="Commissions"
              description="Sales rep commission rates, quote totals and payouts."
            />
          </div>
        </section>

        {/* Step 38B: users moved to their own page, /admin/team (Shop settings → Team & users) */}
      </div>
    </main>
  );
}

type NavCardProps = {
  href: string;
  title: string;
  description: string;
};

function NavCard({ href, title, description }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm transition hover:border-[var(--action-primary)]/50 hover:bg-[var(--surface-card)]"
    >
      <div className="mb-2 text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--action-primary)]">
        {title}
      </div>
      <p className="flex-1 text-xs text-[var(--text-secondary)]">{description}</p>
      <div className="mt-3 text-[11px] text-[var(--text-faint)]">
        Admin only – not visible to customers.
      </div>
    </Link>
  );
}
