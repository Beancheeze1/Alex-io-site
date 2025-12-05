// app/quote/layout.tsx
//
// Auth-guarded layout for all /quote* pages.
// - If not logged in, redirect to /login?next=/quote
// - If logged in, render the quote pages as normal.

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
    // Path A minimal: we send them to /quote after login,
    // not yet preserving specific quote_no or sub-path.
    redirect("/login?next=/quote");
  }

  return <>{children}</>;
}
