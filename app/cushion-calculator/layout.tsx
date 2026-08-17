// app/cushion-calculator/layout.tsx
//
// Route-specific metadata for the public cushion curve calculator. The rest
// of the site (e.g. /landing) just inherits root metadata, but this page is
// explicitly meant to be indexed, shared, and found on its own (SEO /
// trust-building tool, not a paid-traffic landing page) so it gets its own
// title/description/OG tags rather than the generic root ones.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free Foam Cushion Curve Calculator | Packaging Material Selector | Alex-IO",
  description:
    "Free cushion curve calculator for foam packaging engineers. Enter product weight, fragility (G-force rating), and drop height to get real material and thickness recommendations from tested cushion curve data. No signup required.",
  keywords: [
    "cushion curve calculator",
    "foam packaging calculator",
    "fragility g-force calculator",
    "packaging foam thickness calculator",
    "ASTM D-3332 drop height",
    "foam packaging material selector",
    "cushion curve",
  ],
  authors: [{ name: "Alex-IO" }],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    title: "Free Foam Cushion Curve Calculator | Alex-IO",
    description:
      "Enter product weight, fragility, and drop height to get real cushion curve-based material and thickness recommendations. Free, no signup.",
    url: "https://api.alex-io.com/cushion-calculator",
    siteName: "Alex-IO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Foam Cushion Curve Calculator | Alex-IO",
    description:
      "Enter product weight, fragility, and drop height to get real cushion curve-based material and thickness recommendations. Free, no signup.",
  },
};

export default function CushionCalculatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
