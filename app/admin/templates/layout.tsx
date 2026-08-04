// app/admin/templates/layout.tsx
//
// Owner-only gate for /admin/templates. Email templates have no tenant_id
// column -- one shared set for the whole platform (editing/deactivating a
// template here affects every tenant's outgoing email), not something any
// individual tenant's admin should reach. The page component itself is a
// client component with no auth check of its own, so this server layout
// is the only thing standing between a tenant admin who guesses the URL
// and the (owner-only) API underneath.

import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TemplatesLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies();
  if (!user || user.role !== "admin" || !isPlatformOwner(user)) redirect("/login");
  return <>{children}</>;
}
