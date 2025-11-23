// app/quote/page.tsx
//
// Server wrapper for the quote print page.
// It does NOT touch the DB or read search params.
// All real logic lives in the client component.

import QuotePrintClient from "./QuotePrintClient";

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;
export const runtime = "nodejs";

export default function Page() {
  // Simple shell so Next can render /quote safely at build time.
  return <QuotePrintClient />;
}
