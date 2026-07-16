// app/quote/page.tsx
//
// Server wrapper for the quote print page.
//
// NOTE:
// We no longer gate on searchParams.quote_no here, because in some
// environments searchParams can be empty on the initial server render
// even when the URL has ?quote_no=... . That was causing the
// "No quote selected" state to show incorrectly.
//
// Instead, we always render the client component. QuotePrintClient
// is responsible for reading quote_no from the URL and deciding what
// to show (full quote vs. friendly empty state).

import QuotePrintClient from "./QuotePrintClient";
import { getCurrentUserFromCookies, isRoleAllowed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;
export const runtime = "nodejs";

export default async function Page() {
  // Simple shell so Next can render /quote safely at build time.
  // The client component reads quote_no from the URL as before.
  //
  // isStaffView: this page is shared by two audiences — customers opening
  // their emailed quote link, and reps/CS/admins previewing it from the
  // admin quote page. Same URL, same component; only a logged-in staff
  // session distinguishes them. Used to swap the "Forward to sales" button
  // (customer-facing wording — a customer looping in a rep) for "Email
  // quote" (staff wording — they're already sales, not forwarding to it).
  const user = await getCurrentUserFromCookies();
  const isStaffView = isRoleAllowed(user, ["sales", "cs", "admin"]);

  return <QuotePrintClient isStaffView={isStaffView} />;
}
