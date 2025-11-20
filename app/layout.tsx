// app/layout.tsx
import "../styles/globals.css";
import BrandHeader from "@/components/BrandHeader";
import LeftNav from "@/components/LeftNav";
import { headers } from "next/headers";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Alex-IO — Reply to inbound emails in seconds",
  description:
    "HubSpot-native email bot with quoting, pricing tiers, and turn times.",
};

// MARK: Root layout must be async if we call headers()
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Await headers() inside layouts
  const h = await headers();
  const path = h.get("x-invoke-path") || "";

  // Detect foam layout editor route
  const hideNav = path.startsWith("/quote/layout");

  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-800">
        <BrandHeader />

        <div
          className={
            hideNav
              ? // Full width for layout editor
                "mx-auto w-full px-4 py-6"
              : // Regular app layout
                "mx-auto flex max-w-7xl gap-6 px-4 py-6"
          }
        >
          {!hideNav && <LeftNav />}

          <main
            className={hideNav ? "w-full" : "min-w-0 flex-1"}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
