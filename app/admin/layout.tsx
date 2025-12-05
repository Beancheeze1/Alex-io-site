// app/admin/layout.tsx
//
// Auth-guarded layout for all /admin/* pages.
// - If not logged in, redirect to /login?next=/admin
// - If logged in, render the normal admin UI.

import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: Props) {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    // Minimal Path A: we don't preserve deep admin sub-paths yet,
    // we just send them to /admin after login.
    redirect("/login?next=/admin");
  }

  return <>{children}</>;
}
