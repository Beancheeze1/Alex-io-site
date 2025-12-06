// app/quote/layout.tsx
//
// Public shell for all /quote* pages.
// - Customer-facing quote links must NOT require login.
// - Admin / rep tools are protected separately under /admin and via APIs.

import { ReactNode } from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
};

export default function QuoteSectionLayout({ children }: Props) {
  // No auth guard here on purpose: quote links in emails are public.
  return <>{children}</>;
}
