// app/layout.tsx
import "../styles/globals.css";
import BrandHeader from "@/components/BrandHeader";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Alex-IO — Reply to inbound emails in seconds",
  description:
    "HubSpot-native email bot with quoting, pricing tiers, and turn times.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-800">
        <BrandHeader />
        {/* Full-width content, no LeftNav */}
        <main className="mx-auto w-full max-w-7xl px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
