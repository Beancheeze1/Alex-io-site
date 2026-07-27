// app/embed/quote-viewer/page.tsx
//
// Chrome-free variant of /quote, meant to be loaded inside an <iframe> on
// a tenant's own website via embed.js. Same component/logic as the normal
// interactive quote viewer (QuotePrintClient) — just without the branded
// "Powered by Alex-IO" header/action-button chrome — wrapped in
// EmbedResizeReporter so the host page can size the iframe to match
// actual content height.
//
// quote_no is read from the URL by QuotePrintClient itself, same as the
// normal /quote page. Always the customer (non-staff) view — embeds are
// for a tenant's own customers, not internal staff tooling.
//
// Tenant resolution is unchanged: this page is served from the tenant's
// own subdomain (TENANT.api.alex-io.com/embed/quote-viewer), so the
// existing Host-header-based tenant logic applies exactly as it does for
// every other page — nothing tenant-specific is hardcoded here.

"use client";

import QuotePrintClient from "@/app/quote/QuotePrintClient";
import EmbedResizeReporter from "@/components/embed/EmbedResizeReporter";

export default function EmbedQuoteViewerPage() {
  return (
    <EmbedResizeReporter>
      <QuotePrintClient embedded isStaffView={false} />
    </EmbedResizeReporter>
  );
}
