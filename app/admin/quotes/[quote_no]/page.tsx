// app/admin/quotes/[quote_no]/page.tsx
//
// Admin quote detail page (internal engineering view).
// Path A / Straight Path safe:
//  - Thin server wrapper around the existing AdminQuoteClient.
//  - No changes to pricing, cavity parsing, or quote print behavior.
//  - Uses the route param quote_no and passes it into the client component.

import AdminQuoteClient from "./AdminQuoteClient";

type AdminQuotePageProps = {
  params: {
    quote_no: string;
  };
};

export default function AdminQuotePage({ params }: AdminQuotePageProps) {
  // Decode in case the quote number contains URL-encoded characters.
  const quoteNo = params?.quote_no
    ? decodeURIComponent(params.quote_no)
    : "";

  return <AdminQuoteClient quoteNo={quoteNo} />;
}
