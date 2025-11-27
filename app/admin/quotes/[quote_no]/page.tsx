// app/admin/quotes/[quote_no]/page.tsx
//
// Server wrapper for the internal admin quote view.
// Passes the dynamic route param into AdminQuoteClient.

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
