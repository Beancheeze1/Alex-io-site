// app/layout.tsx
import "../styles/globals.css";
import type { Metadata } from "next";
import { getCurrentUserFromCookies } from "@/lib/auth";

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
  const currentUser = await getCurrentUserFromCookies();

  return (
    <html lang="en">
      <head>
        {/* Google Ads conversion tracking */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=AW-18060048309"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'AW-18060048309');
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-neutral-50 text-neutral-800">
        <main className="relative w-full px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}