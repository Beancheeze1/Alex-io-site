// app/admin/layout.tsx
//
// Auth-guarded and role-aware shell for all /admin/* pages.
// - Requires a valid session cookie
// - Only allows role === "admin" into /admin
// - Adds a simple top nav + user chip + log out button

import { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { resolveTenantFromHost } from "@/lib/tenant";
import LogoutButton from "@/components/LogoutButton";
import AdminAlertsBell from "@/components/admin/AdminAlertsBell";
import AdminNav, { type AdminNavItem, type AdminNavMenu } from "@/components/admin/AdminNav";
import { tenantQuoteTypes } from "@/lib/quote-types-server";
import { offersFoam } from "@/lib/quote-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

// Owner-only tenant admin allowlist (UI)
const TENANT_WRITE_EMAIL_ALLOWLIST = new Set<string>([
  "25thhourdesign@gmail.com",
]);

function canSeeTenantsLink(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return TENANT_WRITE_EMAIL_ALLOWLIST.has(email);
}

export default async function AdminLayout({ children }: Props) {
  const user = await getCurrentUserFromCookies();

  // Not logged in → go to login, and return here after
  if (!user) {
    redirect("/login?next=/admin");
  }

  // Allow admin, cs, sales into /admin shell; restrict what they can access via nav + per-page guards.
  // Viewer (or unknown) gets pushed out.
  const role = (user.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isCS = role === "cs";
  const isSales = role === "sales";

  if (!isAdmin && !isCS && !isSales) {
    redirect("/");
  }

  // Gates every nav link that points at platform-wide (not tenant-scoped)
  // data: Tenants, Traffic, Products, Templates, Logs, Leads. Matches the
  // server-side isPlatformOwner() enforcement each of those pages/APIs has
  // independently -- this just keeps a regular tenant admin from seeing a
  // link to somewhere they can't actually go.
  const showOwnerOnlyLinks = role === "admin" && canSeeTenantsLink(user);

  // Step 38A: grouped menus. Pricing pages only for what the shop sells:
  // corrugated for Boxes only / Complete Pack, stock cartons and foam pages
  // for foam shops. Retired from the menu: Pricing (price books), Logs,
  // Products, Templates (pages still exist; nothing links to them).
  const types = await tenantQuoteTypes(Number(user.tenant_id)).catch(() => null);
  const sellsFoam = types ? offersFoam(types) : true;
  const sellsBoxes = types ? types.includes("boxes_only") || types.includes("complete_pack") : true;
  const opt = (on: boolean, item: AdminNavItem): AdminNavItem[] => (on ? [item] : []);

  const quotesMenu: AdminNavMenu = {
    key: "quotes",
    label: "Quotes",
    items: [
      { href: "/admin/quotes", label: isSales ? "My quotes" : "All quotes" },
      { href: "/admin/review", label: "Review queue", review: true },
      { href: "/admin/spec-requests", label: "Spec requests" },
    ],
  };
  const navHome = isAdmin ? { href: "/admin", label: "Home" } : null;
  const navMenus: AdminNavMenu[] = isAdmin
    ? [
        quotesMenu,
        {
          key: "pricing",
          label: "Pricing",
          items: [
            ...opt(sellsBoxes, { href: "/admin/corrugated", label: "Corrugated boxes" }),
            ...opt(sellsFoam, { href: "/admin/boxes", label: "Stock cartons" }),
            ...opt(sellsFoam, { href: "/admin/materials", label: "Foam materials" }),
            ...opt(sellsFoam, { href: "/admin/settings#foam-rates", label: "Foam cutting rates" }),
            { href: "/admin/settings#freight", label: "Freight & shipping" },
          ],
        },
        {
          key: "settings",
          label: "Shop settings",
          items: [
            { href: "/admin#team", label: "Team & users" },
            { href: "/admin/settings#quote-terms", label: "Quote terms & buyer emails" },
            { href: "/admin#widget", label: "Website & chat widget" },
            { href: "/admin/get-started", label: "Setup checklist" },
            { href: "/admin/cleanup", label: "Data cleanup" },
          ],
        },
        {
          key: "reports",
          label: "Reports",
          items: [
            { href: "/admin/funnel", label: "Funnel" },
            { href: "/admin/commissions", label: "Commissions" },
            { href: "/admin/expenses", label: "Expenses" },
          ],
        },
      ]
    : isSales
      ? [
          quotesMenu,
          {
            key: "reports",
            label: "Reports",
            items: [
              { href: "/admin/commissions", label: "My commissions" },
              { href: "/admin/expenses", label: "My expenses" },
            ],
          },
        ]
      : [quotesMenu];
  const ownerMenu: AdminNavMenu | null = showOwnerOnlyLinks
    ? {
        key: "owner",
        label: "Alex-IO",
        items: [
          { href: "/admin/tenants", label: "Shops" },
          { href: "/admin/traffic", label: "Website traffic" },
          { href: "/admin/leads", label: "Demo leads" },
          { href: "/admin/cleanup", label: "Test quote cleanup" },
          { href: "/admin/materials", label: "Foam catalog" },
        ],
      }
    : null;

  // Tenant-aware admin header label:
  // - Core host (api.alex-io.com) -> "Alex-IO Admin"
  // - Tenant host (<slug>.api.alex-io.com) -> "<Tenant Name> Admin" (brandName preferred)
  let adminHeaderLabel = "Alex-IO Admin";
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
      adminHeaderLabel = `${name} Admin`;
    }
  } catch {
    // Fail closed to core label (no throw, no regression)
    adminHeaderLabel = "Alex-IO Admin";
  }

  return (
    <div className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      {/* Step 38A: wraps on a phone (menus under the shop name, user chip below) */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-medium tracking-wide text-[var(--text-primary)]">
            {adminHeaderLabel}
          </span>

          {/* Step 38A: grouped menus (components/admin/AdminNav.tsx) */}
          <nav aria-label="Admin">
            <AdminNav home={navHome} menus={navMenus} ownerMenu={ownerMenu} />
          </nav>
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <AdminAlertsBell />
          <span>{user.name || user.email}</span>
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            {user.role}
          </span>
          <LogoutButton />
        </div>
      </header>

      <main className="px-4 py-4">{children}</main>
    </div>
  );
}
