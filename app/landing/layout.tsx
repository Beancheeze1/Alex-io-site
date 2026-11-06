// app/landing/layout.tsx
//
// Step 48: the landing page is a client component, so its page-level
// metadata lives here. The canonical address tells search engines that
// alex-io.com, www.alex-io.com and tracking-tagged links (?utm_...) are all
// this one page.
// Step 48b: landing-only title (64 chars) and description (153 chars), within
// Bing's limits and covering corrugated + displays. app/layout.tsx keeps the
// site-wide defaults for every other page.
import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Foam & Corrugated Quoting Software for Packaging Shops | Alex-IO";
const DESCRIPTION =
  "Quote foam inserts, corrugated boxes and POP displays in minutes. Your buyers get instant prices on your own branded page, with DXF upload and CAD files.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://api.alex-io.com/landing" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://api.alex-io.com/landing",
    siteName: "Alex-IO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function LandingLayout({ children }: { children: ReactNode }) {
  return children;
}
