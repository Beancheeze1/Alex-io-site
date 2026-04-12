// app/layout.tsx
import "../styles/globals.css";
import type { Metadata } from "next";
import { getCurrentUserFromCookies } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Quoting Software for Foam Fabricators | Alex-IO",
  description:
    "Alex-IO is quoting software built specifically for foam fabricators and packaging shops. Real material pricing, layered cavity layouts, and printable customer-ready quotes — generated in minutes, not days.",
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
          {/* Root layout without the global Alex-IO top banner.
              Individual pages (quote, layout editor, admin, etc.)
              can render their own headers as needed. */}
          {children}
        </main>
      </body>
    </html>
  );
}