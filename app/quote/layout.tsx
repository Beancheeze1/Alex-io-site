// app/quote/layout.tsx
//
// Public layout shell for all /quote* pages.
// - No auth guard here so customer-facing quote links
//   (e.g. /quote?quote_no=Q-...) work without login.
// - Admin / sales protections live under /admin and /my-quotes.

import { ReactNode } from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

export default function QuoteSectionLayout({ children }: Props) {
  return <>{children}</>;
}
