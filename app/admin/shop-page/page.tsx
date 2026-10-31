// app/admin/shop-page/page.tsx
//
// Step 45: Shop settings → Shop page. The shop's admins edit their own
// Quotes & ordering page (components/admin/ShopPageEditor.tsx). Admins only.

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import ShopPageEditor from "@/components/admin/ShopPageEditor";

export const dynamic = "force-dynamic";

export default async function ShopPageSettings() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?next=/admin/shop-page");
  if (String(user.role || "").toLowerCase() !== "admin") redirect("/admin/quotes");

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-4xl px-4 py-8 lg:py-10">
        <header className="mb-6 border-b border-[var(--border)] pb-5">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Shop page</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            Your Quotes &amp; ordering page: the page buyers land on to quote, look up a quote or sign in to their
            orders. Change what it says and how it looks here; empty sections stay hidden on the page.
          </p>
        </header>
        <ShopPageEditor />
      </div>
    </main>
  );
}
