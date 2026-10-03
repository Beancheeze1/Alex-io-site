// app/t/[tenant]/page.tsx
//
// Tenant "Quotes & ordering" page (layout C, Oct 2026 redesign).
// Server-rendered from tenants.theme_json so branding is correct on first
// paint and the browser title is white-labeled. Every content block hides
// itself when its theme_json fields are empty.
//
// The root layout wraps pages in <main className="px-4 py-6">; the outer
// "-mx-4 -my-6" div cancels that so the banner runs edge to edge.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SplashChatWidget from "@/components/SplashChatWidget";
import TenantLogo from "@/components/tenant/TenantLogo";
import QuoteLookupCard from "@/components/tenant/QuoteLookupCard";
import { loadTenantPage, PRODUCT_INFO, type ProductKey } from "@/lib/tenant-page";

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
  const title = `Quotes & ordering | ${t.brandName}`;
  return {
    title,
    description: t.quoteIntro,
    keywords: null,
    authors: null,
    robots: { index: false, follow: false },
    openGraph: { title, description: t.quoteIntro, siteName: t.brandName, type: "website" },
    twitter: { card: "summary", title, description: t.quoteIntro },
  };
}

function ProductIcon({ k }: { k: ProductKey }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (k) {
    case "rsc":
      return (
        <svg {...common}>
          <path d="M3 8l9-4 9 4v9l-9 4-9-4z" />
          <path d="M3 8l9 4 9-4M12 12v9" />
        </svg>
      );
    case "printed":
      return (
        <svg {...common}>
          <path d="M3 8l9-4 9 4v9l-9 4-9-4z" />
          <path d="M6 12.5l4 1.8M6 15.5l4 1.8" />
        </svg>
      );
    case "mailer":
      return (
        <svg {...common}>
          <rect x="3" y="9" width="18" height="10" rx="1.5" />
          <path d="M3 9l3-4h12l3 4M9 13h6" />
        </svg>
      );
    case "foam":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="7" y="9" width="6" height="6" rx="1.5" />
          <circle cx="16.5" cy="12" r="1.8" />
        </svg>
      );
    case "kit":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M3 7l2-3h14l2 3" />
          <rect x="7" y="11" width="10" height="5" rx="1.5" />
        </svg>
      );
  }
}

export default async function TenantQuoteCenter({ params, searchParams }: PageProps) {
  const { tenant } = await params;
  const sp = await searchParams;
  const t = await loadTenantPage(tenant);
  if (!t) notFound();

  const repRaw = sp.sales_rep_slug;
  const salesRepSlug = typeof repRaw === "string" ? repRaw.trim().slice(0, 100) : "";
  const startQuotePath =
    `/start-quote?tenant=${encodeURIComponent(t.slug)}` +
    (salesRepSlug ? `&sales_rep_slug=${encodeURIComponent(salesRepSlug)}` : "");

  const hasProducts = t.products.length > 0;
  const hasAbout = !!t.aboutText || t.stats.length > 0;
  const hasTalkCard = !!t.phone || !!t.email;
  const hasContactStrip = !!(t.phone || t.email || t.address || t.hours);

  const primaryBtn = { background: t.primaryColor, color: t.onPrimary };
  const bannerText = t.heroImageUrl ? "#FFFFFF" : t.onSecondary;

  const monogram = (
    <span
      className="flex h-11 w-11 items-center justify-center rounded-md text-base font-medium"
      style={primaryBtn}
      aria-hidden="true"
    >
      {t.initials}
    </span>
  );

  const nameBlock = (
    <span className="flex items-center gap-3">
      {monogram}
      <span className="leading-tight">
        <span className="block text-lg font-medium">{t.brandName}</span>
        {t.tagline ? (
          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
            {t.tagline}
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <div className="-mx-4 -my-6" style={{ background: "var(--surface-page)", color: "var(--text-primary)" }}>
      {/* Utility bar */}
      {t.websiteUrl || t.hours || t.phone ? (
        <div className="text-[13px]" style={{ background: t.secondaryColor, color: t.onSecondary }}>
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-1 px-6 py-1.5">
            {t.websiteUrl ? (
              <a href={t.websiteUrl} className="mr-auto py-1 hover:underline">
                ← {t.websiteLabel}
              </a>
            ) : (
              <span className="mr-auto" />
            )}
            {t.hours ? <span className="py-1 opacity-85">{t.hours}</span> : null}
            {t.phone ? (
              t.phoneHref ? (
                <a href={t.phoneHref} className="py-1 font-medium hover:underline">
                  {t.phone}
                </a>
              ) : (
                <span className="py-1 font-medium">{t.phone}</span>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Header */}
      <header style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border)" }}>
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3.5">
          <div className="mr-auto">
            {t.heroUseLogo && t.logoUrl ? (
              <TenantLogo src={t.logoUrl} alt={t.brandName} fallback={nameBlock} />
            ) : (
              nameBlock
            )}
          </div>
          <nav aria-label="Page sections" className="flex flex-wrap gap-x-6 gap-y-1 text-[15px]">
            {hasProducts ? (
              <a href="#products" className="py-2 hover:underline">
                Products
              </a>
            ) : null}
            {hasAbout ? (
              <a href="#about" className="py-2 hover:underline">
                About
              </a>
            ) : null}
            {hasContactStrip ? (
              <a href="#contact" className="py-2 hover:underline">
                Contact
              </a>
            ) : null}
          </nav>
          <a
            href={startQuotePath}
            className="inline-flex min-h-[44px] items-center rounded-md px-5 text-[15px] font-medium"
            style={primaryBtn}
          >
            Request a quote
          </a>
        </div>
      </header>

      {/* Banner */}
      <section className="relative overflow-hidden" style={{ background: t.secondaryColor, color: bannerText }}>
        {t.heroImageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, rgba(10,12,16,0.86) 0%, rgba(10,12,16,0.62) 50%, rgba(10,12,16,0.30) 100%)",
              }}
            />
          </>
        ) : null}
        <div className="relative mx-auto max-w-[1200px] px-6 pb-36 pt-16">
          <div className="mb-2.5 text-sm opacity-80">
            {t.websiteUrl ? (
              <a href={t.websiteUrl} className="hover:underline">
                Home
              </a>
            ) : (
              <span>{t.brandName}</span>
            )}{" "}
            / Quotes &amp; ordering
          </div>
          <h1 className="mb-3 text-4xl font-medium leading-tight md:text-5xl">Quotes &amp; ordering</h1>
          <p className="max-w-[54ch] text-lg opacity-90">{t.quoteIntro}</p>
        </div>
        {t.heroImageUrl && t.heroCaption ? (
          <div className="absolute bottom-3 right-6 text-xs opacity-75">{t.heroCaption}</div>
        ) : null}
      </section>

      {/* Action cards (overlap the banner) */}
      <section className="relative mx-auto -mt-24 max-w-[1200px] px-6">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <div
            className="flex flex-col rounded-xl p-7 shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderTop: `4px solid ${t.primaryColor}`,
            }}
          >
            <h2 className="mb-2 text-xl font-medium">Quote online</h2>
            <p className="mb-5 flex-1" style={{ color: "var(--text-secondary)" }}>
              Build a quote for {t.quoteScope} yourself. You’ll get a layout and pricing, saved under a quote number.
            </p>
            <a
              href={startQuotePath}
              className="inline-flex min-h-[48px] items-center self-start rounded-md px-5 text-[15px] font-medium"
              style={primaryBtn}
            >
              Start an online quote
            </a>
          </div>

          {hasTalkCard ? (
            <div
              className="flex flex-col rounded-xl p-7 shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
              style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
            >
              <h2 className="mb-2 text-xl font-medium">Talk to our team</h2>
              <p className="mb-5 flex-1" style={{ color: "var(--text-secondary)" }}>
                Something custom, or not sure what you need? Call or email and we’ll help you spec it.
              </p>
              <div className="flex flex-wrap gap-2.5">
                {t.phone && t.phoneHref ? (
                  <a
                    href={t.phoneHref}
                    className="inline-flex min-h-[48px] items-center rounded-md px-5 text-[15px] font-medium"
                    style={{ border: "1px solid var(--border-strong)" }}
                  >
                    Call {t.phone}
                  </a>
                ) : null}
                {t.email ? (
                  <a
                    href={`mailto:${t.email}`}
                    className="inline-flex min-h-[48px] items-center rounded-md px-5 text-[15px] font-medium"
                    style={{ border: "1px solid var(--border-strong)" }}
                  >
                    Email us
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <QuoteLookupCard tenantSlug={t.slug} primaryColor={t.primaryColor} onPrimary={t.onPrimary} />
        </div>
      </section>

      {/* Products */}
      {hasProducts ? (
        <section id="products" className="mx-auto max-w-[1200px] px-6 pb-14 pt-16">
          <h2 className="mb-6 text-2xl font-medium">What you can quote online</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.products.map((k) => (
              <div
                key={k}
                className="rounded-xl p-6"
                style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
              >
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-md"
                  style={{ background: "var(--surface-subtle)", color: t.primaryColor }}
                >
                  <ProductIcon k={k} />
                </div>
                <div className="mb-1 text-[17px] font-medium">{PRODUCT_INFO[k].label}</div>
                <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {PRODUCT_INFO[k].desc}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="h-14" />
      )}

      {/* About */}
      {hasAbout ? (
        <section
          id="about"
          style={{
            background: "var(--surface-subtle)",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-14 gap-y-8 px-6 py-16">
            <div className="min-w-0 flex-[1_1_460px]">
              <h2 className="mb-3 text-2xl font-medium">About {t.brandName}</h2>
              {t.aboutText ? (
                <p className="mb-4 whitespace-pre-line text-[17px]" style={{ color: "var(--text-secondary)" }}>
                  {t.aboutText}
                </p>
              ) : null}
              {t.websiteUrl ? (
                <a href={t.websiteUrl} className="font-medium hover:underline" style={{ color: t.primaryColor }}>
                  More about us on {t.websiteLabel} →
                </a>
              ) : null}
            </div>
            {t.stats.length ? (
              <div
                className="grid min-w-0 flex-[1_1_380px] grid-cols-2 gap-px overflow-hidden rounded-xl"
                style={{ background: "var(--border)", border: "1px solid var(--border)" }}
              >
                {t.stats.map((s, i) => (
                  <div key={i} className="px-5 py-4" style={{ background: "var(--surface-card)" }}>
                    <div className="text-2xl font-medium leading-tight">{s.value}</div>
                    <div className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Contact strip */}
      {hasContactStrip ? (
        <section id="contact" className="mx-auto grid max-w-[1200px] gap-6 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {t.phone ? (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Call
              </div>
              {t.phoneHref ? (
                <a href={t.phoneHref} className="text-lg font-medium hover:underline">
                  {t.phone}
                </a>
              ) : (
                <div className="text-lg font-medium">{t.phone}</div>
              )}
            </div>
          ) : null}
          {t.email ? (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Email
              </div>
              <a href={`mailto:${t.email}`} className="break-all text-lg font-medium hover:underline">
                {t.email}
              </a>
            </div>
          ) : null}
          {t.address ? (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Plant
              </div>
              <div className="text-lg font-medium">{t.address}</div>
            </div>
          ) : null}
          {t.hours ? (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Hours
              </div>
              <div className="text-lg font-medium">{t.hours}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Footer */}
      <footer style={{ background: t.secondaryColor, color: t.onSecondary }}>
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-6 pb-24 pt-6 text-[13px]">
          <span className="opacity-85">
            © {new Date().getFullYear()} {t.brandName}
          </span>
          {t.websiteUrl ? (
            <a href={t.websiteUrl} className="opacity-85 hover:underline">
              {t.websiteLabel}
            </a>
          ) : null}
          <span className="ml-auto opacity-70">Online quoting by Alex-IO</span>
        </div>
      </footer>

      {t.landingChatEnabled ? (
        <SplashChatWidget startQuotePath={startQuotePath} salesRepSlug={salesRepSlug} />
      ) : null}
    </div>
  );
}
