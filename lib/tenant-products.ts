// lib/tenant-products.ts
//
// The product tiles under "What you can quote online" on a shop's Quotes &
// ordering page (app/t/[tenant]/page.tsx). Pure (no DB); tested in
// scripts/test-display-assembly.ts. Moved here from lib/tenant-page.ts in
// Step 42.

import type { QuoteTypeKey } from "@/lib/quote-types";

// Step 42: "display" is added on its own for a shop that offers Boxes and
// Displays quotes (withDisplayProduct); it isn't a checkbox on Admin → Tenants.
export const PRODUCT_KEYS = ["rsc", "printed", "mailer", "display", "foam", "kit"] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

export const PRODUCT_INFO: Record<ProductKey, { label: string; desc: string }> = {
  rsc: { label: "Corrugated boxes", desc: "Regular slotted cartons in single and double wall." },
  printed: { label: "Printed packaging", desc: "Boxes printed with your logo and handling marks." },
  mailer: { label: "Die-cut mailers", desc: "Self-locking mailers for shipping and retail." },
  display: { label: "Displays", desc: "Retail displays, priced part by part from your die line." },
  foam: { label: "Foam inserts", desc: "Foam cut to hold your product in place." },
  kit: { label: "Foam-in-box kits", desc: "Box and insert quoted together as one kit." },
};

/**
 * Step 42: the shop's products with "Displays" added when it offers Boxes and
 * Displays quotes (after its box tiles). A shop with no products listed keeps
 * the section hidden. Pure.
 */
export function withDisplayProduct(products: ProductKey[], types: QuoteTypeKey[]): ProductKey[] {
  const list = products.filter((k) => k !== "display");
  if (!list.length || !types.includes("boxes_only")) return list;
  let at = 0;
  list.forEach((k, i) => {
    if (k === "rsc" || k === "printed" || k === "mailer") at = i + 1;
  });
  return [...list.slice(0, at), "display", ...list.slice(at)];
}
