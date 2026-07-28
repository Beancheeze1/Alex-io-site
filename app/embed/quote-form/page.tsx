// app/embed/quote-form/page.tsx
//
// Chrome-free variant of /start-quote, meant to be loaded inside an
// <iframe> on a tenant's own website via embed.js. Same component/logic
// as the normal quote-form flow (StartQuoteModal) — just without the
// full-page modal chrome (backdrop, fixed positioning, Close button) and
// wrapped in EmbedResizeReporter so the host page can size the iframe to
// match actual content height.
//
// Tenant resolution is unchanged: this page is served from the tenant's
// own subdomain (TENANT.api.alex-io.com/embed/quote-form), so the existing
// Host-header-based middleware/tenant logic applies exactly as it does for
// every other page — nothing tenant-specific is hardcoded here.

"use client";

import * as React from "react";
import { Suspense } from "react";
import StartQuoteModal from "@/components/start-quote/StartQuoteModal";
import EmbedResizeReporter from "@/components/embed/EmbedResizeReporter";

export default function EmbedQuoteFormPage() {
  // Tenant theme: resolved server-side (middleware sets x-tenant-slug from
  // the Host header), so no tenant param is needed here — same source as
  // every other tenant-aware page.
  React.useEffect(() => {
    fetch(`/api/tenant/theme?t=${Math.random()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok || !data?.theme_json) return;

        const primary = data.theme_json.primaryColor || "#2B2B28";
        const secondary = data.theme_json.secondaryColor || "#3D3D38";

        document.documentElement.style.setProperty("--tenant-primary", primary);
        document.documentElement.style.setProperty("--tenant-secondary", secondary);
      })
      .catch(() => {});
  }, []);

  return (
    <EmbedResizeReporter>
      <div className="bg-[var(--surface-page)]">
        <Suspense fallback={null}>
          <StartQuoteModal embedded quoteSource="embed_website" />
        </Suspense>
      </div>
    </EmbedResizeReporter>
  );
}
