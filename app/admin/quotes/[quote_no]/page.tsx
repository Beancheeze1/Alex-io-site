// app/admin/quotes/[quote_no]/page.tsx
//
// Server wrapper for the internal admin quote view.
// Uses the dynamic route segment [quote_no] and passes it
// into the client component as a prop.
//
// URL pattern:
//   /admin/quotes/Q-AI-20251116-115613
//
// This page is intended for internal / engineering use only.

import AdminQuoteClient from "./AdminQuoteClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
  params: {
    quote_no: string;
  };
};

export default function Page({ params }: PageProps) {
  const quoteNo = params.quote_no || "";
  return <AdminQuoteClient quoteNo={quoteNo} />;
}
