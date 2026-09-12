// app/layout.tsx
import "../styles/globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { initializeApp } from "@/lib/startup";

// initializeApp();   // ← COMMENTED OUT for build (we'll fix this cleanly next)

export const metadata: Metadata = {
  title: "Foam Insert Quoting Software | RFQ to Priced Quote in Minutes | Alex-IO",
  description:
    "Alex-IO is quoting software built specifically for foam fabricators and packaging shops. Real material pricing, layered cavity layouts, and printable customer-ready quotes — generated in minutes, not days.",
  keywords: [
    "foam insert quoting software",
    "foam fabricator quoting tool",
    "custom foam packaging software",
    "foam packaging CPQ",
    "foam insert layout editor",
    "foam quoting automation",
  ],
  authors: [{ name: "Alex-IO" }],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    title: "Foam Insert Quoting Software | Alex-IO",
    description:
      "Turn RFQs into priced quotes with cavity layout, CAD exports, and followup. Automatically. Live pricing, layout editor, and email workflow in one place.",
    url: "https://api.alex-io.com/landing",
    siteName: "Alex-IO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Foam Insert Quoting Software | Alex-IO",
    description:
      "Turn RFQs into priced quotes with cavity layout, CAD exports, and followup. Automatically.",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Safe initialization — now runs inside the layout function
  // (skipped automatically during Next.js build phase)
  initializeApp();

  const currentUser = await getCurrentUserFromCookies();

  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-800">
        {/* Google Ads conversion tracking — loads after the page is interactive so it no longer blocks initial render/LCP */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-18060048309"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-18060048309');
          `}
        </Script>
        <main className="relative w-full px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}