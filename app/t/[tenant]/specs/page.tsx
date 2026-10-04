// app/t/[tenant]/specs/page.tsx
//
// "Send us your specs" page for a tenant. Server-rendered and white-labeled
// like /t/[tenant]; the form itself is a client component.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpecRequestForm from "@/components/tenant/SpecRequestForm";
import { loadTenantPage } from "@/lib/tenant-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ tenant: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant } = await params;
  const t = await loadTenantPage(tenant);
  if (!t) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = `Send us your specs | ${t.brandName}`;
  return {
    title,
    description: `Send drawings or specs to ${t.brandName} for a packaging quote.`,
    keywords: null,
    authors: null,
    robots: { index: false, follow: false },
    openGraph: { title, siteName: t.brandName, type: "website" },
    twitter: { card: "summary", title },
  };
}

export default async function SpecsPage({ params }: PageProps) {
  const { tenant } = await params;
  const t = await loadTenantPage(tenant);
  if (!t) notFound();

  const backHref = `/t/${encodeURIComponent(t.slug)}`;

  return (
    <div className="-mx-4 -my-6 min-h-screen" style={{ background: "var(--surface-page)", color: "var(--text-primary)" }}>
      <header style={{ background: t.secondaryColor, color: t.onSecondary }}>
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-4 px-6 py-4">
          <a href={backHref} className="text-sm hover:underline">
            ← Quotes &amp; ordering
          </a>
          <span className="ml-auto text-sm font-medium">{t.brandName}</span>
        </div>
      </header>
      <main className="mx-auto max-w-[860px] px-6 pb-24 pt-10">
        <h1 className="mb-2 text-3xl font-medium">Send us your specs</h1>
        <p className="mb-8 max-w-[60ch] text-[17px]" style={{ color: "var(--text-secondary)" }}>
          Have a drawing, a photo of a sample, or something custom? Send it over and our team will put together a quote.
        </p>
        <SpecRequestForm
          tenantSlug={t.slug}
          brandName={t.brandName}
          primaryColor={t.primaryColor}
          onPrimary={t.onPrimary}
          backHref={backHref}
        />
      </main>
    </div>
  );
}
