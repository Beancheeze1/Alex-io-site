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

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;
export const runtime = "nodejs";

export default function Page() {
  // Simple shell so Next can render /quote safely at build time.
  // The client component reads quote_no from the URL as before.
  return <QuotePrintClient />;
}
