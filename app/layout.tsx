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
          {currentUser && (
            <div className="pointer-events-auto absolute right-4 top-4 z-10">
              <form
                action="/api/auth/logout"
                method="POST"
                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700 shadow-sm"
              >
                <span className="font-medium">
                  Signed in as{" "}
                  {currentUser.name?.trim()
                    ? currentUser.name
                    : currentUser.email}
                </span>
                <button
                  type="submit"
                  className="rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[11px] font-medium hover:bg-neutral-200"
                >
                  Logout
                </button>
              </form>
            </div>
          )}

          {/* Root layout without the global Alex-IO top banner.
              Individual pages (quote, layout editor, admin, etc.)
              can render their own headers as needed. */}
          {children}
        </main>
      </body>
    </html>
  );
}
