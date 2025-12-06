// app/admin/layout.tsx
//
// Auth-guarded and role-aware shell for all /admin/* pages.
// - Requires a valid session cookie
// - Only allows role === "admin" into /admin
// - Adds a simple top nav + user chip + log out button

import { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: Props) {
  const user = await getCurrentUserFromCookies();

  // Not logged in → go to login, and return here after
  if (!user) {
    redirect("/login?next=/admin");
  }

  // Logged in but not an admin → push them to *My Quotes* instead of /quote
  if (user.role && user.role !== "admin") {
    redirect("/my-quotes");
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-baseline gap-4">
          <span className="text-sm font-semibold tracking-wide text-neutral-200">
            Alex-IO Admin
          </span>
          <nav className="flex gap-3 text-xs text-neutral-400">
            <Link href="/admin" className="hover:text-neutral-200">
              Dashboard
            </Link>
            <Link href="/admin/materials" className="hover:text-neutral-200">
              Materials
            </Link>
            <Link href="/admin/price-books" className="hover:text-neutral-200">
              Price books
            </Link>
            <Link href="/admin/logs" className="hover:text-neutral-200">
              Logs
            </Link>
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
