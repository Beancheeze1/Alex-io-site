// components/start-quote/useQuoteTypes.ts
//
// Step 11: the quote types the current shop offers, from
// GET /api/public/quote-types. Until it loads (or if it fails) every type is
// offered, so nothing is ever blocked by a slow or failed lookup.

"use client";

import * as React from "react";
import { QUOTE_TYPE_KEYS, type QuoteTypeKey } from "@/lib/quote-types";

export function useQuoteTypes(tenantSlug?: string | null): { types: QuoteTypeKey[]; loaded: boolean } {
  const [types, setTypes] = React.useState<QuoteTypeKey[]>(QUOTE_TYPE_KEYS);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const slug = (tenantSlug || "").trim().toLowerCase();
    const qs = slug ? `?tenant=${encodeURIComponent(slug)}` : "";
    fetch(`/api/public/quote-types${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = Array.isArray(j?.quote_types)
          ? QUOTE_TYPE_KEYS.filter((k) => j.quote_types.includes(k))
          : [];
        if (list.length > 0) setTypes(list);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  return { types, loaded };
}
