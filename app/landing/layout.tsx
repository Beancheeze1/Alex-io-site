// app/landing/layout.tsx
//
// Step 48: the landing page is a client component, so its page-level
// metadata lives here. The canonical address tells search engines that
// alex-io.com, www.alex-io.com and tracking-tagged links (?utm_...) are all
// this one page.
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  alternates: { canonical: "https://api.alex-io.com/landing" },
};

export default function LandingLayout({ children }: { children: ReactNode }) {
  return children;
}
