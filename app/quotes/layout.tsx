// app/quotes/layout.tsx
//
// Auth guard for /quotes (My Quotes).
// Any logged-in user can see their own quotes.
// Unauthenticated users are redirected to login.

import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

export default async function QuotesLayout({ children }: Props) {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect("/login?next=/quotes");
  }

  return <>{children}</>;
}
