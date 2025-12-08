// app/quote/QuotePrintClient.tsx
//
// Client component that:
//  - Reads quote_no from the URL
//  - Calls /api/quote/print to fetch data
//  - Renders the full print view for the client:
//
// Header:
//   - Quote number, customer info, status
//   - Print, Forward to sales, Schedule a call buttons
//
// Body:
//   - Quote overview (specs from primary line item) in a "Specs" card
//   - Pricing summary in a "Pricing" card
//   - Layout status in a "Layout & next steps" card
//   - Line items table (foam items + carton selections + layer lines)
//   - Foam layout package summary + inline SVG preview
//
// Important:
//   - No SVG/DXF/STEP download links here (client shouldn’t be able to download CAD files).
//   - Layout file downloads can be added later on an internal/admin-only page.
//   - Carton suggestions + selection will live in the editor; this page just *shows*
//     any cartons already attached to the quote via DB.

"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
  created_at: string;
};

type ItemRow = {
  id: number;
  quote_id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  material_name: string | null;
  material_family?: string | null;
  density_lb_ft3?: number | string | null;
  price_unit_usd?: string | null;
  price_total_usd?: string | null;

  pricing_meta?: {
    min_charge?: number | null;
    used_min_charge?: boolean;
    setup_fee?: number | null;
    kerf_waste_pct?: number | null;
  } | null;

  pricing_breakdown?: {
    volumeIn3: number;
    materialWeightLb: number;
    materialCost: number;
    machineMinutes: number;
    machineCost: number;
    rawCost: number;
    markupFactor: number;
    sellPrice: number;
    unitPrice: number;
    extendedPrice: number;
    qty: number;
    breaks: {
      qty: number;
      unit: number;
      total: number;
    }[];
  } | null;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

type ApiOk = {
  ok: true;
  quote: QuoteRow;
  items: ItemRow[];
  layoutPkg: LayoutPkgRow | null;
  foamSubtotal: number;
  packagingSubtotal: number;
  grandSubtotal: number;
};


type ApiErr = {
  ok: false;
  error: string;
  message: string;
};

type ApiResponse = ApiOk | ApiErr;

// ===== Requested cartons API (for-quote) =====

type RequestedBox = {
  id: number; // quote_box_selections.id
  quote_id: number;
  box_id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  qty: number;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  // Optional pricing fields from quote_box_selections
  unit_price_usd?: number | string | null;
  extended_price_usd?: number | string | null;
};



type RequestedBoxesOk = {
  ok: true;
  selections: RequestedBox[];
};

type RequestedBoxesErr = {
  ok: false;
  error: string;
};

type RequestedBoxesResponse = RequestedBoxesOk | RequestedBoxesErr;

function parsePriceField(
  raw: string | number | null | undefined,
): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatDimPart(raw: any): string {
  if (raw === null || raw === undefined) return "";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return String(raw ?? "");

  // Round to 2 decimals, then strip trailing .00 or .10 → .1, etc.
  const rounded = Math.round(n * 100) / 100;
  const s = rounded
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");

  return s;
}

function formatDims(l: any, w: any, h: any): string {
  return [l, w, h].map(formatDimPart).join(" x ");
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export default function QuotePrintClient() {
  const searchParams = useSearchParams();

  const initialQuoteNo = searchParams?.get("quote_no") || "";
  const [quoteNo, setQuoteNo] = React.useState<string>(initialQuoteNo);

  const [loading, setLoading] = React.useState<boolean>(
    !!(initialQuoteNo || quoteNo),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState<string | null>(null);
  const [quote, setQuote] = React.useState<QuoteRow | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(null);

  // Requested cartons stored in DB (from /api/boxes/for-quote)
  const [requestedBoxes, setRequestedBoxes] = React.useState<RequestedBox[]>(
    [],
  );

    // Subtotals from server: foam, packaging, grand
  const [foamSubtotal, setFoamSubtotal] = React.useState<number>(0);
  const [packagingSubtotal, setPackagingSubtotal] =
    React.useState<number>(0);
  const [grandSubtotal, setGrandSubtotal] = React.useState<number>(0);


  // Which carton selection is currently being removed (for button disable/spinner)
  const [removingBoxId, setRemovingBoxId] = React.useState<number | null>(null);

  // Ref to the SVG preview container so we can scale/center the inner <svg>
  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Print handler
  const handlePrint = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.print();
    }
  }, []);

  // Helper: refresh requested cartons from /api/boxes/for-quote
  const refreshRequestedBoxes = React.useCallback(async () => {
    if (!quoteNo) return;
    try {
      const res = await fetch(
        "/api/boxes/for-quote?quote_no=" + encodeURIComponent(quoteNo),
        { cache: "no-store" },
      );
      const json = (await res.json()) as RequestedBoxesResponse;

      if (!res.ok || !json.ok) {
        console.error("Error loading requested cartons:", json);
        setRequestedBoxes([]);
        return;
      }

      setRequestedBoxes(json.selections || []);
    } catch (err) {
      console.error("Error fetching /api/boxes/for-quote:", err);
      setRequestedBoxes([]);
    }
  }, [quoteNo]);

  // Forward-to-sales handler (mailto with quote number + link + requested cartons)
  const handleForwardToSales = React.useCallback(() => {
    if (typeof window === "undefined") return;

    const effectiveQuoteNo = quote?.quote_no || quoteNo;
    if (!effectiveQuoteNo) return;

    const salesEmail =
      (process.env.NEXT_PUBLIC_SALES_FORWARD_TO as string | undefined) ||
      "sales@example.com";

    const subject = "Quote " + effectiveQuoteNo;

    const bodyLines: string[] = [
      "Quote number: " + effectiveQuoteNo,
      "",
      "View this quote:",
      window.location.href,
    ];

    const primaryQty = items[0]?.qty ?? 1;

    // Build "Customer-requested cartons" section from requestedBoxes
    const requestedLines: string[] = [];

    for (const sel of requestedBoxes) {
      const labelParts: string[] = [];

      if (sel.description && sel.description.trim().length > 0) {
        labelParts.push(sel.description.trim());
      } else {
        const styleLabel = sel.style ? sel.style : "Carton";
        labelParts.push(`${styleLabel} ${sel.sku}`);
      }

      const dimsOk =
        Number.isFinite(sel.inside_length_in) &&
        Number.isFinite(sel.inside_width_in) &&
        Number.isFinite(sel.inside_height_in);

      const dimsLabel = dimsOk
        ? `Inside ${formatDims(
            sel.inside_length_in,
            sel.inside_width_in,
            sel.inside_height_in,
          )} in`
        : null;

      if (sel.vendor) {
        labelParts.push(`Vendor: ${sel.vendor}`);
      }

      const labelMain = labelParts.join(" · ");
      const qty = sel.qty || primaryQty;

      requestedLines.push(
        `- ${labelMain}${dimsLabel ? ` (${dimsLabel})` : ""} – Qty ${qty}`,
      );
    }

    if (requestedLines.length > 0) {
      bodyLines.push("", "Customer-requested cartons:", ...requestedLines);
    }

    bodyLines.push("", "Thanks!");

    const body = encodeURIComponent(bodyLines.join("\n"));

    const mailto =
      "mailto:" +
      encodeURIComponent(salesEmail) +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      body;

    window.location.href = mailto;
  }, [quoteNo, quote, items, requestedBoxes]);

  // Schedule call handler (Calendly or Google Calendar URL)
  const handleScheduleCall = React.useCallback(() => {
    if (typeof window === "undefined") return;

    const url =
      (process.env.NEXT_PUBLIC_SCHEDULE_CALL_URL as string | undefined) ||
      "https://calendly.com/your-company/30min";

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // Helper to reload quote data from /api/quote/print (used on initial load and after removals)
  const reloadQuoteData = React.useCallback(
    async (qNo: string) => {
      try {
        const res = await fetch(
          "/api/quote/print?quote_no=" + encodeURIComponent(qNo),
          { cache: "no-store" },
        );

        const json = (await res.json()) as ApiResponse;

        if (!res.ok) {
          if (!json.ok && (json as ApiErr).error === "NOT_FOUND") {
            setNotFound((json as ApiErr).message || "Quote not found.");
          } else if (!json.ok) {
            setError(
              (json as ApiErr).message ||
                "There was a problem loading this quote.",
            );
          } else {
            setError("There was a problem loading this quote.");
          }
          return;
        }

        if (json.ok) {
  setQuote(json.quote);
  setItems(json.items || []);
  setLayoutPkg(json.layoutPkg || null);

  // Subtotals from server (fallback to 0 if missing)
  const asOk = json as ApiOk;
  setFoamSubtotal(
    typeof asOk.foamSubtotal === "number" ? asOk.foamSubtotal : 0,
  );
  setPackagingSubtotal(
    typeof asOk.packagingSubtotal === "number"
      ? asOk.packagingSubtotal
      : 0,
  );
  setGrandSubtotal(
    typeof asOk.grandSubtotal === "number" ? asOk.grandSubtotal : 0,
  );
} else {
  setError("Unexpected response from quote API.");
}

      } catch (err) {
        console.error("Error fetching /api/quote/print:", err);
        setError(
          "There was an unexpected problem loading this quote. Please try again.",
        );
      }
    },
    [],
  );

  // Remove handler for carton selections
  const handleRemoveCarton = React.useCallback(
    async (selectionId: number) => {
      if (!quoteNo || !selectionId) return;

      try {
        setRemovingBoxId(selectionId);

        const res = await fetch("/api/boxes/remove-from-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Using selectionId here; server can map from selection → [CARTON] quote_items rows
            quoteNo,
            selectionId,
          }),
        });

        if (!res.ok) {
          console.error(
            "Failed to remove carton selection:",
            await res.text().catch(() => ""),
          );
          return;
        }

        // Refresh requested cartons
        await refreshRequestedBoxes();

        // Refresh quote items in case any carton quote_items were removed or pricing changed
        await reloadQuoteData(quoteNo);
      } catch (err) {
        console.error("Error calling /api/boxes/remove-from-quote:", err);
      } finally {
        setRemovingBoxId(null);
      }
    },
    [quoteNo, refreshRequestedBoxes, reloadQuoteData],
  );

  // Rescue: if router searchParams didn’t have quote_no, fall back to window.location
  React.useEffect(() => {
    if (quoteNo) return;
    if (typeof window === "undefined") return;

    const urlParams = new URLSearchParams(window.location.search);
    const fromWindow = urlParams.get("quote_no") || "";

    if (fromWindow) {
      setQuoteNo(fromWindow);
    } else {
      setLoading(false);
    }
  }, [quoteNo]);

  // Fetch quote data
  React.useEffect(() => {
    if (!quoteNo) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(null);
      setQuote(null);
      setItems([]);
      setLayoutPkg(null);

      try {
        await reloadQuoteData(quoteNo);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [quoteNo, reloadQuoteData]);

  // Load requested cartons from DB whenever quoteNo changes
  React.useEffect(() => {
    if (!quoteNo) return;
    refreshRequestedBoxes();
  }, [quoteNo, refreshRequestedBoxes]);

  const overallQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  // anyPricing: use grandSubtotal (foam + packaging) if available,
  // but still works if only foam is priced.
  const anyPricing = grandSubtotal > 0 || foamSubtotal > 0;


  const notesPreview =
    layoutPkg && layoutPkg.notes && layoutPkg.notes.trim().length > 0
      ? layoutPkg.notes.trim().length > 140
        ? layoutPkg.notes.trim().slice(0, 140) + "..."
        : layoutPkg.notes.trim()
      : null;

  // Normalize SVG preview
  React.useEffect(() => {
    if (!layoutPkg) return;
    if (!svgContainerRef.current) return;

    const svgEl = svgContainerRef.current.querySelector("svg") as
      | SVGSVGElement
      | null;

    if (!svgEl) return;

    try {
      svgEl.removeAttribute("width");
      svgEl.removeAttribute("height");
      svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

      svgEl.style.width = "100%";
      svgEl.style.height = "100%";
      svgEl.style.display = "block";
      svgEl.style.margin = "0 auto";
    } catch (e) {
      console.warn("Could not normalize SVG preview:", e);
    }
  }, [layoutPkg]);

  const primaryItem = items[0] || null;
  const primaryPricing = primaryItem?.pricing_meta || null;
  const minChargeApplied = !!primaryPricing?.used_min_charge;
  const setupFee =
    typeof primaryPricing?.setup_fee === "number"
      ? primaryPricing.setup_fee
      : null;
  const kerfPct =
    typeof primaryPricing?.kerf_waste_pct === "number"
      ? primaryPricing.kerf_waste_pct
      : null;

  // material display lines for primary item
  const primaryMaterialName =
    primaryItem?.material_name ||
    (primaryItem ? `Material #${primaryItem.material_id}` : "");

  let primaryMaterialSubline: string | null = null;
  if (primaryItem) {
    const subParts: string[] = [];
    if (primaryItem.material_family) {
      subParts.push(primaryItem.material_family);
    }
    const densRaw = (primaryItem as any).density_lb_ft3;
    const densNum =
      typeof densRaw === "number"
        ? densRaw
        : densRaw != null
        ? Number(densRaw)
        : NaN;
    if (Number.isFinite(densNum) && densNum > 0) {
      subParts.push(`${densNum.toFixed(1)} lb/ft³`);
    }
    if (subParts.length) {
      primaryMaterialSubline = subParts.join(" · ");
    }
  }

  // breakdown from server, if available
  const primaryBreakdown = primaryItem?.pricing_breakdown || null;

  const breakdownUnitPrice =
    primaryBreakdown && Number.isFinite(primaryBreakdown.unitPrice)
      ? primaryBreakdown.unitPrice
      : parsePriceField(primaryItem?.price_unit_usd ?? null);

    const breakdownSubtotal =
    primaryBreakdown && Number.isFinite(primaryBreakdown.extendedPrice)
      ? primaryBreakdown.extendedPrice
      : foamSubtotal;


  const materialCost =
    primaryBreakdown && Number.isFinite(primaryBreakdown.materialCost)
      ? primaryBreakdown.materialCost
      : null;

  const machineCost =
    primaryBreakdown && Number.isFinite(primaryBreakdown.machineCost)
      ? primaryBreakdown.machineCost
      : null;

  const rawCost =
    primaryBreakdown && Number.isFinite(primaryBreakdown.rawCost)
      ? primaryBreakdown.rawCost
      : null;

  const markupFactor =
    primaryBreakdown && Number.isFinite(primaryBreakdown.markupFactor)
      ? primaryBreakdown.markupFactor
      : null;

  const priceBreaks = primaryBreakdown?.breaks ?? [];

  // Shared card styles
  const cardBase: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    padding: "12px 14px",
  };

  const cardTitleStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "#0f172a",
    marginBottom: 6,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#6b7280",
    marginBottom: 2,
  };

  // ===== Layer rows derived from layout_json (display only, no pricing) =====
  const layerDisplayRows = React.useMemo(
    () => {
      if (!layoutPkg || !layoutPkg.layout_json) return [];

      let json: any = layoutPkg.layout_json;
      if (typeof json === "string") {
        try {
          json = JSON.parse(json);
        } catch {
          return [];
        }
      }

      const layers = Array.isArray(json.layers) ? json.layers : [];
      if (!layers.length) return [];

      const block = json.block || json.outerBlock || {};
      const rawL = block.lengthIn ?? block.length_in;
      const rawW = block.widthIn ?? block.width_in;

      const L = Number(rawL);
      const W = Number(rawW);

      if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
        return [];
      }

      const result: {
        key: string;
        name: string;
        dims: string;
        qty: number;
      }[] = [];

            layers.forEach((layer: any, index: number) => {
        // Only show layers that have their *own* thickness.
        // We intentionally DO NOT fall back to block height here
        // to avoid ghost "6 inch" rows when total stack is 6"
        // but each layer is 3".
        const tRaw = layer.thicknessIn ?? layer.thickness_in;
        const T = Number(tRaw);
        if (!Number.isFinite(T) || T <= 0) return; // skip layers without a real thickness

        const name =
          (typeof layer.name === "string" && layer.name.trim()) ||
          `Layer ${index + 1}`;

        // If your file already uses formatDims, keep that:
        // const dimsStr = `${formatDims(L, W, T)} in`;
        const dimsStr = `${L} × ${W} × ${T}`;
        const qty = primaryItem?.qty ?? 1;

        result.push({
          key: `layer-${layer.id ?? index}`,
          name,
          dims: dimsStr,
          qty,
        });
      });


      return result;
    },
    [layoutPkg, primaryItem],
  );

  // ===================== RENDER =====================

  return (
    <div
      style={{
        fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
        background: "#020617",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "24px",
          padding: "24px 24px 32px 24px",
          boxShadow: "0 16px 40px rgba(15,23,42,0.45)",
        }}
      >
        {/* No quote number at all */}
        {!quoteNo && !loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#555" }}>
              We could not find a quote number in this link. Please double-check
              the URL or open the quote directly from your inbox.
            </p>
          </>
        )}

        {/* Loading */}
        {loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Loading quote...</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              Please wait while we load the latest version of this quote.
            </p>
          </>
        )}

        {/* Not found from API */}
        {!loading && notFound && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#555" }}>
              {notFound}{" "}
              {quoteNo ? (
                <>
                  (quote number: <code>{quoteNo}</code>)
                </>
              ) : null}
            </p>
          </>
        )}

        {/* Hard error */}
        {!loading && error && !quote && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>
              Problem loading quote
            </h1>
            {quoteNo && (
              <p style={{ color: "#555", marginBottom: 6 }}>
                Quote number: <code>{quoteNo}</code>
              </p>
            )}
            <p style={{ color: "#6b7280", fontSize: 13 }}>{error}</p>
          </>
        )}

        {/* Happy path */}
        {!loading && quote && (
          <>
            {/* Gradient header */}
            <div
              style={{
                margin: "-24px -24px 20px -24px",
                padding: "16px 24px",
                borderRadius: "24px 24px 0 0",
                background:
                  "linear-gradient(90deg,#0ea5e9 0%,#22d3ee 35%,#6366f1 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                color: "#e5e7eb",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    opacity: 0.9,
                    marginBottom: 4,
                  }}
                >
                  Powered by Alex-IO
                </div>
                <div
                  style={{
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                >
                  Interactive quote viewer
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    opacity: 0.94,
                  }}
                >
                  Quote {quote.quote_no}
                </div>
                <p
                  style={{
                    margin: "2px 0 0 0",
                    fontSize: 12,
                    opacity: 0.9,
                  }}
                >
                  {quote.customer_name}
                  {quote.company ? <> • {quote.company}</> : null}
                  {quote.email ? <> • {quote.email}</> : null}
                  {quote.phone ? <> • {quote.phone}</> : null}
                </p>
              </div>

              <div
                style={{
                  textAlign: "right",
                  fontSize: 12,
                  color: "#e5e7eb",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(15,23,42,0.2)",
                    border: "1px solid rgba(15,23,42,0.25)",
                    color: "#f9fafb",
                    fontWeight: 600,
                  }}
                >
                  {quote.status.toUpperCase()}
                </div>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: 11,
                    opacity: 0.9,
                  }}
                >
                  Created: {new Date(quote.created_at).toLocaleString()}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={handlePrint}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid rgba(15,23,42,0.15)",
                      background: "rgba(15,23,42,0.12)",
                      color: "#e5e7eb",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    Print this quote
                  </button>
                  <button
                    type="button"
                    onClick={handleForwardToSales}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid rgba(15,23,42,0.15)",
                      background: "rgba(15,23,42,0.12)",
                      color: "#e5e7eb",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    Forward to sales
                  </button>
                  <button
                    type="button"
                    onClick={handleScheduleCall}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #0f172a",
                      background: "#0f172a",
                      color: "#f9fafb",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Schedule a call
                  </button>
                </div>
              </div>
            </div>

            {/* TOP ROW: Specs / Pricing / Layout */}
            {primaryItem && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                  gap: 16,
                  marginBottom: 20,
                }}
              >
                {/* Specs card */}
                <div style={cardBase}>
                  <div style={cardTitleStyle}>Specs</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={labelStyle}>Dimensions</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {formatDims(
                          primaryItem.length_in,
                          primaryItem.width_in,
                          primaryItem.height_in,
                        )}{" "}
                        in
                      </div>
                    </div>

                    <div>
                      <div style={labelStyle}>Quantity</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {primaryItem.qty.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Material</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {primaryMaterialName}
                      </div>
                      {primaryMaterialSubline && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 2,
                          }}
                        >
                          {primaryMaterialSubline}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pricing card */}
                <div style={cardBase}>
                  <div style={cardTitleStyle}>Pricing</div>
                  {anyPricing ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        fontSize: 13,
                        color: "#111827",
                      }}
                    >
                      <div>
                        <div style={labelStyle}>Primary unit price</div>
                        <div>{formatUsd(breakdownUnitPrice ?? null)}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Estimated subtotal</div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>
                          {formatUsd(breakdownSubtotal)}
                        </div>
                      </div>

                                            {packagingSubtotal > 0 && (
                        <div>
                          <div style={labelStyle}>Packaging subtotal</div>
                          <div style={{ fontSize: 13 }}>
                            {formatUsd(packagingSubtotal)}
                          </div>
                        </div>
                      )}

                      {grandSubtotal > 0 && (
                        <div>
                          <div style={labelStyle}>
                            Combined estimate (foam + packaging)
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>
                            {formatUsd(grandSubtotal)}
                          </div>
                        </div>
                      )}


                      {primaryBreakdown && (
                        <>
                          <div
                            style={{
                              marginTop: 4,
                              paddingTop: 6,
                              borderTop: "1px dashed #e5e7eb",
                              display: "grid",
                              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                              gap: 8,
                            }}
                          >
                            <div>
                              <div style={labelStyle}>Material</div>
                              <div style={{ fontSize: 13 }}>
                                {formatUsd(materialCost)}
                              </div>
                            </div>
                            <div>
                              <div style={labelStyle}>Machine</div>
                              <div style={{ fontSize: 13 }}>
                                {formatUsd(machineCost)}
                              </div>
                            </div>
                            <div>
                              <div style={labelStyle}>Raw cost</div>
                              <div style={{ fontSize: 13 }}>
                                {formatUsd(rawCost)}
                              </div>
                            </div>
                            <div>
                              <div style={labelStyle}>Markup</div>
                              <div style={{ fontSize: 13 }}>
                                {markupFactor != null
                                  ? (() => {
                                      const over = (markupFactor - 1) * 100;
                                      if (over > 0) {
                                        return `${over.toFixed(
                                          0,
                                        )}% over cost`;
                                      }
                                      return `${markupFactor.toFixed(2)}×`;
                                    })()
                                  : "—"}
                              </div>
                            </div>
                          </div>

                          {priceBreaks && priceBreaks.length > 1 && (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 11,
                                color: "#6b7280",
                                lineHeight: 1.4,
                              }}
                            >
                              <span style={{ fontWeight: 500 }}>
                                Example price breaks:{" "}
                              </span>
                              {priceBreaks
                                .filter((b) => b.qty === 10 || b.qty === 50)
                                .map(
                                  (b) =>
                                    `${b.qty} pcs – ${formatUsd(
                                      b.unit,
                                    )}/pc`,
                                )
                                .join(" · ")}
                            </div>
                          )}
                        </>
                      )}

                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: "#6b7280",
                          lineHeight: 1.4,
                        }}
                      >
                        {primaryPricing ? (
                          <>
                            <span>
                              Pricing includes material, cutting, and
                              standard waste allowance
                              {typeof kerfPct === "number"
                                ? ` (~${kerfPct}% kerf)`
                                : ""}.
                              {materialCost != null && machineCost != null
                                ? ` In this estimate, material is approximately ${formatUsd(
                                    materialCost,
                                  )} and machine time approximately ${formatUsd(
                                    machineCost,
                                  )} before markup.`
                                : ""}

                              {setupFee && setupFee > 0
                                ? ` A one-time setup fee of ${formatUsd(
                                    setupFee,
                                  )} is included.`
                                : ""}

                              {minChargeApplied
                                ? ` A minimum charge of ${formatUsd(
                                    primaryPricing.min_charge ??
                                      breakdownSubtotal ??
                                      foamSubtotal,
                                  )} applies to this configuration.`
                                : ""}
                            </span>
                            <br />
                            Final billing may adjust if specs, quantities, or
                            services change.
                          </>
                        ) : (
                          "Final billing may adjust if specs, quantities, or services change."
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        lineHeight: 1.5,
                      }}
                    >
                      Pricing is still being finalized for this quote. Once
                      pricing is applied, the per-piece and subtotal values will
                      appear here and in the line items below.
                    </div>
                  )}
                </div>

                {/* Layout & next steps card */}
                <div style={cardBase}>
                  <div style={cardTitleStyle}>Layout & next steps</div>
                  <div
                    style={{
                      marginBottom: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "#eef2ff",
                      color: "#1d4ed8",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Interactive layout
                  </div>

                  {layoutPkg ? (
                    <>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#111827",
                          marginBottom: 4,
                        }}
                      >
                        A foam layout has been saved for this quote.
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginBottom: 8,
                          lineHeight: 1.4,
                        }}
                      >
                        You can open the layout editor from this page or from
                        your emailed quote to adjust pocket locations before
                        finalizing.
                      </div>
                      {notesPreview && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#4b5563",
                            background: "#eef2ff",
                            borderRadius: 10,
                            padding: "6px 8px",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>Notes: </span>
                          {notesPreview}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        lineHeight: 1.5,
                      }}
                    >
                      No foam layout has been saved yet. Use the layout editor
                      link in your emailed quote to place cavities where you’d
                      like your parts to sit, then click{" "}
                      <strong>Apply to quote</strong> to store the layout with
                      this quote.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LINE ITEMS CARD (foam items + layers + carton selections) */}
            <div
              style={{
                ...cardBase,
                background: "#ffffff",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#0f172a",
                  marginBottom: 4,
                }}
              >
                Line items
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginBottom: 8,
                }}
              >
                These are the materials and quantities currently stored with your
                quote.
              </div>

              {items.length === 0 &&
              requestedBoxes.length === 0 &&
              layerDisplayRows.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>
                  No line items stored for this quote yet. Once the material and
                  details are finalized, the primary line will appear here.
                </p>
              ) : (
                <>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                      marginBottom: 12,
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#eef2ff" }}>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Item
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Dimensions (L x W x H in)
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Qty
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Unit price
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Line total
                        </th>
                      </tr>
                    </thead>
                    
                                          <tbody>
                      {/* Foam / core quote items (priced) */}
                      {items.length > 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid #e5e7eb",
                              background: "#f9fafb",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: "#6b7280",
                            }}
                          >
                            Foam materials
                          </td>
                        </tr>
                      )}
                      {items.map((item, idx) => {

                        const dims = `${formatDims(
                          item.length_in,
                          item.width_in,
                          item.height_in,
                        )} in`;

                        const baseLabel =
                          item.material_name ||
                          "Material #" + item.material_id;

                        const subParts: string[] = [];
                        if (item.material_family) {
                          subParts.push(item.material_family);
                        }
                        const densRaw = (item as any).density_lb_ft3;
                        const densNum =
                          typeof densRaw === "number"
                            ? densRaw
                            : densRaw != null
                            ? Number(densRaw)
                            : NaN;
                        if (Number.isFinite(densNum) && densNum > 0) {
                          subParts.push(`${densNum.toFixed(1)} lb/ft³`);
                        }
                        const subLabel =
                          subParts.length > 0
                            ? subParts.join(" · ")
                            : null;

                        const unit = parsePriceField(
                          item.price_unit_usd ?? null,
                        );
                        const total = parsePriceField(
                          item.price_total_usd ?? null,
                        );
                        return (
                          <tr key={item.id}>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                              }}
                            >
                              <div style={{ fontWeight: 500 }}>
                                Line {idx + 1}
                              </div>
                              <div style={{ color: "#6b7280" }}>
                                {baseLabel}
                                {subLabel && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      marginTop: 2,
                                    }}
                                  >
                                    {subLabel}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                              }}
                            >
                              {dims}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                              }}
                            >
                              {item.qty}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                              }}
                            >
                              {formatUsd(unit)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                              }}
                            >
                              {formatUsd(total)}
                            </td>
                          </tr>
                        );
                      })}

                      {/* Foam layers (display only, not priced separately) */}
                      {layerDisplayRows.map((layer) => (
                        <tr key={layer.key}>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            <div style={{ fontWeight: 500 }}>
                              Foam layer: {layer.name}
                            </div>
                            <div
                              style={{
                                color: "#6b7280",
                                fontSize: 11,
                                marginTop: 2,
                              }}
                            >
                              Layer details from saved layout (for reference;
                              included in foam pricing above).
                            </div>
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {layer.dims}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: "1px solid #f3f4f6",
                              textAlign: "right",
                            }}
                          >
                            {layer.qty}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: "1px solid #f3f4f6",
                              textAlign: "right",
                            }}
                          >
                            {formatUsd(null)}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: "1px solid #f3f4f6",
                              textAlign: "right",
                            }}
                          >
                            {formatUsd(null)}
                          </td>
                        </tr>
                      ))}

                                            {/* Requested cartons appended as additional lines (display only for now) */}
                      {requestedBoxes.length > 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            style={{
                              padding: "6px 8px",
                              borderTop: "1px solid #e5e7eb",
                              borderBottom: "1px solid #f3f4f6",
                              background: "#fef2f2",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: "#b91c1c",
                            }}
                          >
                            Packaging
                          </td>
                        </tr>
                      )}
                      {requestedBoxes.map((rb) => {

                        const mainLabel =
                          (rb.description && rb.description.trim().length > 0
                            ? rb.description.trim()
                            : `${rb.style || "Carton"}`) || "Carton";

                        const dimsOk =
                          Number.isFinite(rb.inside_length_in) &&
                          Number.isFinite(rb.inside_width_in) &&
                          Number.isFinite(rb.inside_height_in);

                        const dimsText = dimsOk
                          ? `${formatDims(
                              rb.inside_length_in,
                              rb.inside_width_in,
                              rb.inside_height_in,
                            )} in`
                          : null;

                        const notesParts: string[] = [];
                        if (rb.sku) notesParts.push(`SKU: ${rb.sku}`);
                        if (rb.vendor) notesParts.push(`Vendor: ${rb.vendor}`);
                        if (dimsText)
                          notesParts.push(`Inside ${dimsText}`);

                        const subLabel =
                          notesParts.length > 0
                            ? notesParts.join(" · ")
                            : null;

                        const dimsDisplay = dimsText ?? "—";

                        const qty = rb.qty || primaryItem?.qty || 1;



                                                 const unitPrice = parsePriceField(
                          (rb as any).unit_price_usd ?? null,
                        );
                        const lineTotal = parsePriceField(
                          (rb as any).extended_price_usd ??
                            (unitPrice != null ? unitPrice * qty : null),
                        );


                        const isRemoving = removingBoxId === rb.id;

                        return (
                          <tr key={`carton-${rb.id}`}>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 600,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.08em",
                                      color: "#4b5563",
                                      marginBottom: 2,
                                    }}
                                  >
                                    Packaging – Carton selection
                                  </div>
                                  <div style={{ fontWeight: 500 }}>
                                    {mainLabel}
                                  </div>
                                  {subLabel && (
                                    <div
                                      style={{
                                        color: "#6b7280",
                                        fontSize: 11,
                                        marginTop: 2,
                                      }}
                                    >
                                      {subLabel}
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCarton(rb.id)}
                                  disabled={isRemoving}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    border: "1px solid #fecaca",
                                    background: isRemoving
                                      ? "#fee2e2"
                                      : "#fef2f2",
                                    color: "#b91c1c",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: isRemoving
                                      ? "default"
                                      : "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {isRemoving ? "Removing…" : "✕ Remove"}
                                </button>
                              </div>
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                              }}
                            >
                              {dimsDisplay}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                              }}
                            >
                              {qty}
                            </td>
                                                          <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                              }}
                            >
                              {formatUsd(unitPrice)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                              }}
                            >
                              {formatUsd(lineTotal)}
                            </td>


                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: 4,
                    }}
                  >
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{ fontSize: 12, color: "#6b7280" }}
                      >
                        Total quantity
                      </div>
                      <div
                        style={{ fontSize: 18, fontWeight: 600 }}
                      >
                        {overallQty}
                      </div>
{anyPricing && (
  <>
    {/* Foam subtotal always shown */}
    <div
      style={{
        marginTop: 4,
        fontSize: 12,
        color: "#6b7280",
      }}
    >
      Foam subtotal
    </div>
    <div
      style={{
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {formatUsd(foamSubtotal)}
    </div>

    {/* Packaging subtotal only if cartons are priced */}
    {packagingSubtotal > 0 && (
      <>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          Packaging subtotal
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {formatUsd(packagingSubtotal)}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          Estimated subtotal (foam + packaging)
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          {formatUsd(grandSubtotal)}
        </div>
      </>
    )}
  </>
)}



                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Foam layout package section */}
            <div
              style={{
                marginTop: 4,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#0f172a",
                  marginBottom: 8,
                }}
              >
                Foam layout package
              </div>

              <div
                style={{
                  ...cardBase,
                  background: "#ffffff",
                }}
              >
                {!layoutPkg ? (
                  <p style={{ color: "#6b7280", fontSize: 13 }}>
                    No foam layout has been saved for this quote yet. Use the{" "}
                    <strong>Open layout preview</strong> button in the emailed
                    quote to arrange cavities, then click{" "}
                    <strong>Apply to quote</strong> to store the layout here.
                  </p>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "#111827",
                            marginBottom: 2,
                          }}
                        >
                          Layout package #{layoutPkg.id}
                        </div>
                        <div
                          style={{
                            color: "#6b7280",
                            fontSize: 12,
                          }}
                        >
                          Saved:{" "}
                          {new Date(
                            layoutPkg.created_at,
                          ).toLocaleString()}
                        </div>
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontSize: 12,
                        }}
                      >
                        <a
                          href={
                            "/quote/layout?quote_no=" +
                            encodeURIComponent(quote.quote_no)
                          }
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: "1px solid #c7d2fe",
                            background: "#eef2ff",
                            color: "#1d4ed8",
                            textDecoration: "none",
                            fontWeight: 500,
                          }}
                        >
                          Open layout editor
                        </a>
                      </div>
                    </div>

                    {notesPreview && (
                      <div
                        style={{
                          marginTop: 6,
                          color: "#4b5563",
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>Notes: </span>
                        {notesPreview}
                      </div>
                    )}

                    {layoutPkg.svg_text &&
                      layoutPkg.svg_text.trim().length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 8,
                            borderRadius: 10,
                            border: "1px solid #e5e7eb",
                            background: "#ffffff",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#374151",
                              marginBottom: 6,
                            }}
                          >
                            Layout preview
                          </div>
                          <div
                            ref={svgContainerRef}
                            style={{
                              width: "100%",
                              height: 480,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                              background: "#f3f4f6",
                              overflow: "hidden",
                            }}
                            dangerouslySetInnerHTML={{
                              __html: layoutPkg.svg_text,
                            }}
                          />
                        </div>
                      )}
                  </>
                )}
              </div>
            </div>

            <p
              style={{
                marginTop: 24,
                fontSize: 12,
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              This print view mirrors the core specs of your emailed quote.
              Actual charges may differ if specs or quantities change or if
              additional services are requested.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
