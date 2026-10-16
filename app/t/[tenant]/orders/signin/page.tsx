// app/t/[tenant]/orders/signin/page.tsx
//
// Step 34A: where the emailed sign-in link lands (?t=<token>). The buyer
// presses "Sign in" (POST /api/portal/verify), so link scanners that open
// the URL don't use up the one-time link.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PortalSignIn from "@/components/portal/PortalSignIn";
import { loadTenantPage } from "@/lib/tenant-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant } = await params;
  const t = await loadTenantPage(tenant);
  if (!t) return { title: "Page not found", robots: { index: false, follow: false } };
  return { title: `Sign in | ${t.brandName}`, robots: { index: false, follow: false }, keywords: null, authors: null };
}

export default async function SignInPage({ params, searchParams }: PageProps) {
  const { tenant } = await params;
  const sp = await searchParams;
  const t = await loadTenantPage(tenant);
  if (!t) notFound();
  const token = typeof sp.t === "string" ? sp.t.trim().slice(0, 100) : "";

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
      <main className="mx-auto max-w-[560px] px-6 pb-24 pt-14">
        <PortalSignIn tenantSlug={t.slug} brandName={t.brandName} token={token} primaryColor={t.primaryColor} onPrimary={t.onPrimary} />
      </main>
    </div>
  );
}
