// app/quote/layout.tsx
//
// Auth guard for all /quote* pages.
// - Requires a valid session
// - If not logged in, redirects to /login first

import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

export default async function QuoteSectionLayout({ children }: Props) {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect("/login?next=/quote");
  }

  return <>{children}</>;
}
