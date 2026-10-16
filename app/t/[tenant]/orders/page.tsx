// app/t/[tenant]/orders/page.tsx
//
// Step 34A: the buyer portal, "Your orders". Server-rendered and white-labeled
// like /t/[tenant]/specs; the sign-in form and the order list are a client
// component (components/portal/OrdersPortal.tsx).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OrdersPortal from "@/components/portal/OrdersPortal";
import { loadTenantPage } from "@/lib/tenant-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ tenant: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant } = await params;
  const t = await loadTenantPage(tenant);
  if (!t) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = `Your orders | ${t.brandName}`;
  return {
    title,
    description: `Your quotes and orders with ${t.brandName}.`,
    keywords: null,
    authors: null,
    robots: { index: false, follow: false },
    openGraph: { title, siteName: t.brandName, type: "website" },
    twitter: { card: "summary", title },
  };
}

export default async function OrdersPage({ params }: PageProps) {
  const { tenant } = await params;
  const t = await loadTenantPage(tenant);
  if (!t) notFound();

  return (
    <div className="-mx-4 -my-6 min-h-screen" style={{ background: "var(--surface-page)", color: "var(--text-primary)" }}>
      <header style={{ background: t.secondaryColor, color: t.onSecondary }}>
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-4 px-6 py-4">
          <a href={`/t/${encodeURIComponent(t.slug)}`} className="text-sm hover:underline">
            ← Quotes &amp; ordering
          </a>
          <span className="ml-auto text-sm font-medium">{t.brandName}</span>
        </div>
      </header>
      <main className="mx-auto max-w-[960px] px-6 pb-24 pt-10">
        <h1 className="mb-2 text-3xl font-medium">Your orders</h1>
        <OrdersPortal tenantSlug={t.slug} brandName={t.brandName} primaryColor={t.primaryColor} onPrimary={t.onPrimary} />
      </main>
    </div>
  );
}
