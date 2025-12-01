// app/admin/quotes/[quote_no]/page.tsx
//
// Admin quote detail view (read-only).
// Path A / Straight Path safe:
//  - NEW FILE ONLY.
//  - Uses existing AdminQuoteClient for engineering/CAD view.
//  - No changes to pricing, parsing, /api/quote/print, or layout editor.
//  - No writes; purely read-only.
//
// Route: /admin/quotes/[quote_no]
//  - Example: /admin/quotes/2025-00123

import AdminQuoteClient from "./AdminQuoteClient";

type PageProps = {
  params: {
    quote_no: string;
  };
};

export default function AdminQuotePage({ params }: PageProps) {
  const quoteNoRaw = params.quote_no ?? "";
  const quoteNo = decodeURIComponent(quoteNoRaw);

  // AdminQuoteClient:
  //  - Accepts quoteNo prop (optional).
  //  - Also falls back to window.location.pathname (/admin/quotes/<quote_no>).
  // To keep things explicit and Path A safe, we pass quoteNo in as a prop.
  return <AdminQuoteClient quoteNo={quoteNo} />;
}
