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
    redirect("/my-quotes");
  }

  const showTenants = role === "admin" && canSeeTenantsLink(user);

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
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-baseline gap-4">
          <span className="text-sm font-semibold tracking-wide text-neutral-200">
            {adminHeaderLabel}
          </span>

          <nav className="flex gap-3 text-xs text-neutral-400">
            {role === "admin" ? (
              <>
                <Link href="/admin" className="hover:text-neutral-200">
                  Dashboard
                </Link>

                {showTenants ? (
                  <Link href="/admin/tenants" className="hover:text-neutral-200">
                    Tenants
                  </Link>
                ) : null}

                <Link href="/admin/materials" className="hover:text-neutral-200">
                  Materials
                </Link>
                <Link href="/admin/pricing" className="hover:text-neutral-200">
                  Pricing
                </Link>
                <Link href="/admin/logs" className="hover:text-neutral-200">
                  Logs
                </Link>
                <Link href="/admin/quotes" className="hover:text-neutral-200">
                  Quotes
                </Link>
              </>
            ) : (
              <>
                <Link href="/admin/quotes" className="hover:text-neutral-200">
                  Quotes
                </Link>
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3 text-xs text-neutral-200">
          <span>{user.name || user.email}</span>
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
            {user.role}
          </span>
          <LogoutButton />
        </div>
      </header>

      <main className="px-4 py-4">{children}</main>
    </div>
  );
}
