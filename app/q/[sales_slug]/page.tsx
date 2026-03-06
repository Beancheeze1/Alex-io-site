"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

/** Mirror of middleware's extractTenantSlugFromHost — runs client-side. */
function getTenantFromHostname(host: string): string {
  const h = host.split(":")[0].toLowerCase();
  if (h === "api.alex-io.com") return "default";
  const parts = h.split(".");
  if (parts.length >= 4 && parts.slice(1).join(".") === "api.alex-io.com") {
    return parts[0] || "default";
  }
  return "default";
}

export default function SalesShortcutToSplash() {
  const router = useRouter();
  const params = useParams() as { sales_slug?: string };

  React.useEffect(() => {
    const slug = String(params?.sales_slug || "").trim();
    const tenant = getTenantFromHostname(window.location.hostname);

    // Send the customer to the tenant-branded splash page.
    // The sales slug rides along so it gets attributed when they start a quote.
    if (slug) {
      router.replace(`/t/${tenant}?sales_rep_slug=${encodeURIComponent(slug)}`);
    } else {
      router.replace(`/t/${tenant}`);
    }
  }, [params?.sales_slug, router]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="text-sm text-slate-300">Loading…</div>
    </main>
  );
}
