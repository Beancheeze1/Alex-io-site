// app/quote/[quote_no]/page.tsx
//
// Step 22: this old /quote/<quote_no> page priced quotes on its own (live,
// cavities subtracted, no price lock), so it could show a different price
// from the real quote page. Nothing links to it any more; old links now go
// to the real quote page, /quote?quote_no=<quote_no>.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OldQuotePage(props: { params: Promise<{ quote_no: string }> }) {
  const { quote_no } = await props.params;
  const quoteNo = decodeURIComponent(quote_no || "").trim();
  redirect(quoteNo ? `/quote?quote_no=${encodeURIComponent(quoteNo)}` : "/quote");
}
