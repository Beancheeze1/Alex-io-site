// app/layout.tsx
import "../styles/globals.css";
import type { Metadata } from "next";
import { getCurrentUserFromCookies } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Alex-IO — Reply to inbound emails in seconds",
  description:
    "HubSpot-native email bot with quoting, pricing tiers, and turn times.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await getCurrentUserFromCookies();

  return (
    <html lang="en">
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
