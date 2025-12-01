// app/admin/quotes/[quote_no]/page.tsx
//
// Admin quote detail host page.
// Path A / Straight Path safe:
//  - Server component wrapper around AdminQuoteClient.
//  - Uses the [quote_no] route param and passes it down.
//  - No DB changes, no pricing/layout logic changes.

import React from "react";
import AdminQuoteClient from "./AdminQuoteClient";

type PageProps = {
  params: {
    quote_no: string;
  };
};

export default function AdminQuotePage({ params }: PageProps) {
  const quoteNo = decodeURIComponent(params.quote_no || "");

  return <AdminQuoteClient quoteNo={quoteNo} />;
}
