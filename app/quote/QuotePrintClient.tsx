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
//   - Foam layout package summary + per-layer previews (no CAD downloads)
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
  inside_length_in: number | string;
  inside_width_in: number | string;
  inside_height_in: number | string;
  // Optional pricing fields from quote_box_selections / boxes
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

// Admin rough shipping settings

type ShippingSettingsResponse = {
  ok: boolean;
  rough_ship_pct: number;
  source?: "db" | "default";
  error?: string;
  message?: string;
};

function parsePriceField(raw: string | number | null | undefined): number | null {
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
  const s = rounded.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");

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

/* ---------------- Layer preview helpers (client-safe, display only) ---------------- */

type LayoutLayer = {
  id?: string;
  label?: string;
  name?: string;
  title?: string;
  thicknessIn?: number;
  thickness_in?: number;
  thickness?: number;
  cavities?: any[];
};

type FlatCavity = {
  lengthIn: number;
  widthIn: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  depthIn?: number | null;
  shape?: "rect" | "circle" | null;
  diameterIn?: number | null;
};

/** Extract the layers array from layout_json (supports stack/layers/foamLayers). */
function getLayersFromLayout(layout: any): LayoutLayer[] {
  if (!layout || typeof layout !== "object") return [];

  if (Array.isArray(layout.stack) && layout.stack.length > 0) return layout.stack as LayoutLayer[];
  if (Array.isArray(layout.layers) && layout.layers.length > 0) return layout.layers as LayoutLayer[];
  if (Array.isArray((layout as any).foamLayers) && (layout as any).foamLayers.length > 0) {
    return ((layout as any).foamLayers as any[]) as LayoutLayer[];
  }

  return [];
}

function getLayerLabel(layer: LayoutLayer | null | undefined, idx: number): string {
  if (!layer) return `Layer ${idx + 1}`;
  const raw = layer.label ?? layer.name ?? layer.title ?? null;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return `Layer ${idx + 1}`;
}

function readPositiveNumber(val: any): number | null {
  if (val == null) return null;

  // Handle shapes like { in: 1.25 }
  if (typeof val === "object" && val) {
    const maybeIn = (val as any).in ?? (val as any).inch ?? (val as any).inches ?? null;
    if (maybeIn != null) val = maybeIn;
  }

  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Resolve layer thickness by index from the full layout object.
 * This avoids mismatches where previews iterate one array (stack)
 * but thickness is stored on another array (layers), or under a different key.
 */
function getLayerThicknessInFromLayout(layout: any, layerIndex: number): number | null {
  if (!layout || typeof layout !== "object") return null;

  const candidates: any[] = [];

  // 1) The same arrays we use for previews
  const previewLayers = getLayersFromLayout(layout);
  if (Array.isArray(previewLayers) && previewLayers[layerIndex]) candidates.push(previewLayers[layerIndex]);

  // 2) Explicit alternates (some older saves store thickness here)
  if (Array.isArray(layout.layers) && layout.layers[layerIndex]) candidates.push(layout.layers[layerIndex]);
  if (Array.isArray(layout.stack) && layout.stack[layerIndex]) candidates.push(layout.stack[layerIndex]);
  if (Array.isArray((layout as any).foamLayers) && (layout as any).foamLayers[layerIndex]) {
    candidates.push((layout as any).foamLayers[layerIndex]);
  }

  // 3) Try common thickness keys across candidates
  for (const layer of candidates) {
    if (!layer) continue;

    const t =
      (layer as any).thicknessIn ??
      (layer as any).thickness_in ??
      (layer as any).thickness ??
      (layer as any).thicknessInches ??
      (layer as any).thickness_inches ??
      (layer as any).thickness_inch ??
      (layer as any).t ??
      (layer as any).heightIn ??
      (layer as any).height_in ??
      null;

    const n = readPositiveNumber(t);
    if (n != null) return n;
  }

  return null;
}


/** Normalize shape field values to rect/circle. Matches admin logic 1:1. */
function normalizeShape(raw: any): "rect" | "circle" | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;

  if (s === "circle" || s === "round" || s === "circular") return "circle";
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";

  return null;
}

/** Flatten cavities for a single layer (supports rect + circle + depth). */
function getCavitiesForLayer(layout: any, layerIndex: number): FlatCavity[] {
  const out: FlatCavity[] = [];
  if (!layout || typeof layout !== "object") return out;

  const layers = getLayersFromLayout(layout);
  if (!Array.isArray(layers) || layers.length === 0) return out;

  const layer = layers[layerIndex];
  if (!layer || !Array.isArray(layer.cavities)) return out;

  for (const cav of layer.cavities) {
    if (!cav) continue;

    const lengthIn = Number((cav as any).lengthIn);
    const widthIn = Number((cav as any).widthIn);
    const x = Number((cav as any).x);
    const y = Number((cav as any).y);

    const depthRaw =
      (cav as any).depthIn ?? (cav as any).depth_in ?? (cav as any).depth ?? (cav as any).pocketDepthIn ?? null;
    const depthNum = depthRaw == null ? NaN : Number(depthRaw);
    const depthIn = Number.isFinite(depthNum) && depthNum > 0 ? depthNum : null;

    if (!Number.isFinite(lengthIn) || lengthIn <= 0) continue;

    const w = Number.isFinite(widthIn) && widthIn > 0 ? widthIn : lengthIn;

    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue;

    const shape = normalizeShape(
      (cav as any).shape ??
        (cav as any).cavityShape ??
        (cav as any).cavity_shape ??
        (cav as any).type ??
        (cav as any).kind,
    );

    const rawDia = (cav as any).diameterIn ?? (cav as any).diameter_in ?? (cav as any).diameter ?? null;
    const diaNum = rawDia == null ? NaN : Number(rawDia);
    const diameterIn =
      shape === "circle"
        ? Number.isFinite(diaNum) && diaNum > 0
          ? diaNum
          : Math.min(lengthIn, w)
        : null;

    out.push({
      lengthIn,
      widthIn: w,
      x,
      y,
      depthIn,
      shape: shape ?? null,
      diameterIn: diameterIn ?? null,
    });
  }

  return out;
}

function fmtInches3(n: number): string {
  // Match the existing feel: 3 decimals like thickness line.
  return n.toFixed(3);
}

/**
 * Summarize pocket depths for a layer:
 * - If no depths exist: null
 * - If one unique depth: "1.250 in"
 * - If multiple: "0.750–1.250 in"
 */
function getPocketDepthSummary(layout: any, layerIndex: number): string | null {
  const cavs = getCavitiesForLayer(layout, layerIndex);
  const depths: number[] = [];

  for (const c of cavs) {
    const d = c.depthIn;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) depths.push(d);
  }

  if (depths.length === 0) return null;

  // De-dupe with small tolerance.
  const sorted = depths.slice().sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const v of sorted) {
    const last = uniq.length ? uniq[uniq.length - 1] : null;
    if (last == null || Math.abs(v - last) > 1e-3) uniq.push(v);
  }

  if (uniq.length === 1) return `${fmtInches3(uniq[0])} in`;

  const min = uniq[0];
  const max = uniq[uniq.length - 1];
  return `${fmtInches3(min)}–${fmtInches3(max)} in`;
}

/**
 * Build a lightweight SVG preview for one layer:
 * - Foam outline rectangle
 * - Cavities as rects or circles (display-only)
 *
 * NOTE: This is display-only and intentionally does not try to match CAD export transforms.
 */
function buildSvgPreviewForLayer(layout: any, layerIndex: number): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  let L = Number(block.lengthIn ?? block.length_in);
  let W = Number(block.widthIn ?? block.width_in);

  if (!Number.isFinite(L) || L <= 0) return null;
  if (!Number.isFinite(W) || W <= 0) W = L;

  const cavs = getCavitiesForLayer(layout, layerIndex);

  const stroke = "#111827";
  const cavStroke = "#ef4444";

  const strokeWidth = Math.max(0.04, Math.min(L, W) / 250);
  const cavStrokeWidth = Math.max(0.03, Math.min(L, W) / 300);

  const shapes = cavs
    .map((c) => {
      const left = L * c.x;
      const top = W * c.y;

      // For rects we use lengthIn x widthIn.
      // For circles we use diameterIn (fallback already handled).
      if (c.shape === "circle") {
        const dia = Number(c.diameterIn);
        const d = Number.isFinite(dia) && dia > 0 ? dia : Math.min(c.lengthIn, c.widthIn);

        const x2 = Math.max(0, Math.min(L, left));
        const y2 = Math.max(0, Math.min(W, top));

        // Clamp diameter so the circle stays inside the foam block.
        const d2 = Math.max(0, Math.min(d, L - x2, W - y2));
        if (d2 <= 0) return "";

        const r = d2 / 2;
        const cx = x2 + r;
        const cy = y2 + r;

        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
      }

      const w = c.lengthIn;
      const h = c.widthIn;

      const x2 = Math.max(0, Math.min(L, left));
      const y2 = Math.max(0, Math.min(W, top));
      const w2 = Math.max(0, Math.min(L - x2, w));
      const h2 = Math.max(0, Math.min(W - y2, h));
      if (w2 <= 0 || h2 <= 0) return "";

      return `<rect x="${x2}" y="${y2}" width="${w2}" height="${h2}" fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
    })
    .filter(Boolean)
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${W}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
    `<rect x="0" y="0" width="${L}" height="${W}" fill="#ffffff" stroke="${stroke}" stroke-width="${strokeWidth}" />`,
    shapes,
    `</svg>`,
  ].join("");
}

export default function QuotePrintClient() {
  const searchParams = useSearchParams();

  const initialQuoteNo = searchParams?.get("quote_no") || "";
  const [quoteNo, setQuoteNo] = React.useState<string>(initialQuoteNo);

  const [loading, setLoading] = React.useState<boolean>(!!(initialQuoteNo || quoteNo));
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState<string | null>(null);
  const [quote, setQuote] = React.useState<QuoteRow | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(null);

  // Requested cartons stored in DB (from /api/boxes/for-quote)
  const [requestedBoxes, setRequestedBoxes] = React.useState<RequestedBox[]>([]);

  // Subtotals from server: foam, packaging, grand (foam + packaging)
  const [foamSubtotal, setFoamSubtotal] = React.useState<number>(0);
  const [packagingSubtotal, setPackagingSubtotal] = React.useState<number>(0);
  const [grandSubtotal, setGrandSubtotal] = React.useState<number>(0);

  // Rough shipping % knob from admin (percent of foam + packaging)
  const [roughShipPct, setRoughShipPct] = React.useState<number | null>(null);

  // Which carton selection is currently being removed (for button disable/spinner)
  const [removingBoxId, setRemovingBoxId] = React.useState<number | null>(null);

  // Client-only: selected layer index for previews
  const [selectedLayerIdx, setSelectedLayerIdx] = React.useState<number>(0);

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
      const res = await fetch("/api/boxes/for-quote?quote_no=" + encodeURIComponent(quoteNo), { cache: "no-store" });
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

    const salesEmail = (process.env.NEXT_PUBLIC_SALES_FORWARD_TO as string | undefined) || "sales@example.com";

    const subject = "Quote " + effectiveQuoteNo;

    const bodyLines: string[] = ["Quote number: " + effectiveQuoteNo, "", "View this quote:", window.location.href];

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

      const L = Number(sel.inside_length_in);
      const W = Number(sel.inside_width_in);
      const H = Number(sel.inside_height_in);

      const dimsOk = Number.isFinite(L) && Number.isFinite(W) && Number.isFinite(H);

      const dimsLabel = dimsOk ? `Inside ${formatDims(L, W, H)} in` : null;

      const labelMain = labelParts.join(" · ");
      const qty = sel.qty || primaryQty;

      requestedLines.push(`- ${labelMain}${dimsLabel ? ` (${dimsLabel})` : ""} – Qty ${qty}`);
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
      (process.env.NEXT_PUBLIC_SCHEDULE_CALL_URL as string | undefined) || "https://calendly.com/your-company/30min";

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // Helper to reload quote data from /api/quote/print (used on initial load and after removals)
  const reloadQuoteData = React.useCallback(async (qNo: string) => {
    try {
      const res = await fetch("/api/quote/print?quote_no=" + encodeURIComponent(qNo), { cache: "no-store" });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok) {
        if (!json.ok && (json as ApiErr).error === "NOT_FOUND") {
          setNotFound((json as ApiErr).message || "Quote not found.");
        } else if (!json.ok) {
          setError((json as ApiErr).message || "There was a problem loading this quote.");
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
        setFoamSubtotal(typeof asOk.foamSubtotal === "number" ? asOk.foamSubtotal : 0);
        setPackagingSubtotal(typeof asOk.packagingSubtotal === "number" ? asOk.packagingSubtotal : 0);
        setGrandSubtotal(typeof asOk.grandSubtotal === "number" ? asOk.grandSubtotal : 0);
      } else {
        setError("Unexpected response from quote API.");
      }
    } catch (err) {
      console.error("Error fetching /api/quote/print:", err);
      setError("There was an unexpected problem loading this quote. Please try again.");
    }
  }, []);

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
          console.error("Failed to remove carton selection:", await res.text().catch(() => ""));
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

  // Load rough shipping % knob from admin
  React.useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch("/api/admin/shipping-settings", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as ShippingSettingsResponse | null;

        if (!active) return;

        if (!res.ok || !json || !json.ok) {
          // Fall back to default 2% if the API isn't ready
          setRoughShipPct(2.0);
          return;
        }

        const pct = json.rough_ship_pct ?? 2.0;
        setRoughShipPct(pct);
      } catch (err) {
        console.error("Failed to load shipping settings (quote view):", err);
        // Safe fallback
        if (active) {
          setRoughShipPct(2.0);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  const overallQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  // Planning notes from layout
  const notesPreview =
    layoutPkg && layoutPkg.notes && layoutPkg.notes.trim().length > 0
      ? layoutPkg.notes.trim().length > 140
        ? layoutPkg.notes.trim().slice(0, 140) + "..."
        : layoutPkg.notes.trim()
      : null;

  const primaryItem = items[0] || null;
  const primaryPricing = primaryItem?.pricing_meta || null;
  const minChargeApplied = !!primaryPricing?.used_min_charge;
  const setupFee = typeof primaryPricing?.setup_fee === "number" ? primaryPricing.setup_fee : null;
  const kerfPct = typeof primaryPricing?.kerf_waste_pct === "number" ? primaryPricing.kerf_waste_pct : null;

  // material display lines for primary item
  const primaryMaterialName = primaryItem?.material_name || (primaryItem ? `Material #${primaryItem.material_id}` : "");

  let primaryMaterialSubline: string | null = null;
  if (primaryItem) {
    const subParts: string[] = [];
    if (primaryItem.material_family) {
      subParts.push(primaryItem.material_family);
    }
    const densRaw = (primaryItem as any).density_lb_ft3;
    const densNum = typeof densRaw === "number" ? densRaw : densRaw != null ? Number(densRaw) : NaN;
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
    primaryBreakdown && Number.isFinite(primaryBreakdown.extendedPrice) ? primaryBreakdown.extendedPrice : foamSubtotal;

  const materialCost =
    primaryBreakdown && Number.isFinite(primaryBreakdown.materialCost) ? primaryBreakdown.materialCost : null;

  const machineCost =
    primaryBreakdown && Number.isFinite(primaryBreakdown.machineCost) ? primaryBreakdown.machineCost : null;

  const rawCost = primaryBreakdown && Number.isFinite(primaryBreakdown.rawCost) ? primaryBreakdown.rawCost : null;

  const markupFactor =
    primaryBreakdown && Number.isFinite(primaryBreakdown.markupFactor) ? primaryBreakdown.markupFactor : null;

  const priceBreaks = primaryBreakdown?.breaks ?? [];

  // Derived packaging subtotal from carton lines (used only if server subtotal is 0)
  const derivedPackagingSubtotal = React.useMemo(() => {
    if (!requestedBoxes || requestedBoxes.length === 0) return 0;

    let sum = 0;
    for (const rb of requestedBoxes) {
      const qty = rb.qty || primaryItem?.qty || 1;

      const unitPriceRaw =
        (rb as any).unit_price_usd ?? (rb as any).base_unit_price ?? (rb as any).price_unit_usd ?? null;

      const unitPrice = parsePriceField(unitPriceRaw);
      if (unitPrice != null && qty > 0) {
        sum += unitPrice * qty;
      }
    }

    if (!Number.isFinite(sum) || sum <= 0) return 0;
    return Math.round(sum * 100) / 100;
  }, [requestedBoxes, primaryItem]);

  const effectivePackagingSubtotal = packagingSubtotal > 0 ? packagingSubtotal : derivedPackagingSubtotal;

  const effectiveGrandSubtotal = grandSubtotal > 0 ? grandSubtotal : foamSubtotal + effectivePackagingSubtotal;

  // anyPricing: use effective grandSubtotal (foam + packaging) if available,
  // but still works if only foam is priced.
  const anyPricing =
    (effectiveGrandSubtotal ?? 0) > 0 || (foamSubtotal ?? 0) > 0 || (breakdownUnitPrice ?? null) != null;

  // Rough shipping estimate from admin knob:
  //   shippingEstimate = (foam+packaging subtotal) * roughShipPct / 100
  const shippingEstimate =
    roughShipPct != null && (effectiveGrandSubtotal ?? 0) > 0
      ? Math.round(effectiveGrandSubtotal * (roughShipPct / 100) * 100) / 100
      : 0;

  // Planning total adds rough shipping to the effective grandSubtotal
  const planningTotal = (effectiveGrandSubtotal ?? 0) + (shippingEstimate || 0);

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
  const layerDisplayRows = React.useMemo(() => {
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
      const tRaw = layer.thicknessIn ?? layer.thickness_in;
      const T = Number(tRaw);
      if (!Number.isFinite(T) || T <= 0) return;

      const name = (typeof layer.name === "string" && layer.name.trim()) || `Layer ${index + 1}`;

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
  }, [layoutPkg, primaryItem]);

  // ===== Per-layer preview cards (customer view) =====
  const layersForPreview = React.useMemo(() => {
    if (!layoutPkg || !layoutPkg.layout_json) return [];

    let json: any = layoutPkg.layout_json;
    if (typeof json === "string") {
      try {
        json = JSON.parse(json);
      } catch {
        return [];
      }
    }

    return getLayersFromLayout(json);
  }, [layoutPkg]);

  React.useEffect(() => {
    const n = layersForPreview?.length || 0;
    if (n <= 0) {
      setSelectedLayerIdx(0);
      return;
    }
    setSelectedLayerIdx((prev) => {
      if (prev < 0) return 0;
      if (prev >= n) return 0;
      return prev;
    });
  }, [layersForPreview]);

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
              We could not find a quote number in this link. Please double-check the URL or open the quote directly from
              your inbox.
            </p>
          </>
        )}

        {/* Loading */}
        {loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Loading quote...</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>Please wait while we load the latest version of this quote.</p>
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
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Problem loading quote</h1>
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
                background: "linear-gradient(90deg,#0ea5e9 0%,#22d3ee 35%,#6366f1 100%)",
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={labelStyle}>Dimensions</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {formatDims(primaryItem.length_in, primaryItem.width_in, primaryItem.height_in)} in
                      </div>
                    </div>

                    <div>
                      <div style={labelStyle}>Quantity</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>{primaryItem.qty.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={labelStyle}>Material</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>{primaryMaterialName}</div>
                      {primaryMaterialSubline && (
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{primaryMaterialSubline}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pricing card */}
                <div style={cardBase}>
                  <div style={cardTitleStyle}>Pricing</div>
                  {anyPricing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "#111827" }}>
                      <div>
                        <div style={labelStyle}>Primary unit price</div>
                        <div>{formatUsd(breakdownUnitPrice ?? null)}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Estimated subtotal</div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{formatUsd(breakdownSubtotal)}</div>
                      </div>

                      {effectivePackagingSubtotal > 0 && (
                        <div>
                          <div style={labelStyle}>Packaging subtotal</div>
                          <div style={{ fontSize: 13 }}>{formatUsd(effectivePackagingSubtotal)}</div>
                        </div>
                      )}

                      {effectiveGrandSubtotal > 0 && (
                        <div>
                          <div style={labelStyle}>Combined estimate (foam + packaging)</div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{formatUsd(effectiveGrandSubtotal)}</div>
                        </div>
                      )}

                      {shippingEstimate > 0 && (
                        <>
                          <div>
                            <div style={labelStyle}>Rough shipping estimate</div>
                            <div style={{ fontSize: 13 }}>
                              {formatUsd(shippingEstimate)}{" "}
                              <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 4 }}>
                                ({roughShipPct?.toFixed(1).replace(/\.0$/, "")}% of foam + packaging; for planning only)
                              </span>
                            </div>
                          </div>

                          {effectiveGrandSubtotal > 0 && (
                            <div>
                              <div style={labelStyle}>Planning total (foam + packaging + shipping)</div>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{formatUsd(planningTotal)}</div>
                            </div>
                          )}
                        </>
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
                              <div style={{ fontSize: 13 }}>{formatUsd(materialCost)}</div>
                            </div>
                            <div>
                              <div style={labelStyle}>Machine</div>
                              <div style={{ fontSize: 13 }}>{formatUsd(machineCost)}</div>
                            </div>
                            <div>
                              <div style={labelStyle}>Raw cost</div>
                              <div style={{ fontSize: 13 }}>{formatUsd(rawCost)}</div>
                            </div>
                            <div>
                              <div style={labelStyle}>Markup</div>
                              <div style={{ fontSize: 13 }}>
                                {markupFactor != null
                                  ? (() => {
                                      const over = (markupFactor - 1) * 100;
                                      if (over > 0) return `${over.toFixed(0)}% over cost`;
                                      return `${markupFactor.toFixed(2)}×`;
                                    })()
                                  : "—"}
                              </div>
                            </div>
                          </div>

                          {priceBreaks && priceBreaks.length > 1 && (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                              <span style={{ fontWeight: 500 }}>Example price breaks: </span>
                              {priceBreaks
                                .filter((b) => b.qty === 10 || b.qty === 50)
                                .map((b) => `${b.qty} pcs – ${formatUsd(b.unit)}/pc`)
                                .join(" · ")}
                            </div>
                          )}
                        </>
                      )}

                      <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                        {primaryPricing ? (
                          <>
                            <span>
                              Pricing includes material, cutting, and standard waste allowance
                              {typeof kerfPct === "number" ? ` (~${kerfPct}% kerf)` : ""}.
                              {materialCost != null && machineCost != null
                                ? ` In this estimate, material is approximately ${formatUsd(
                                    materialCost,
                                  )} and machine time approximately ${formatUsd(machineCost)} before markup.`
                                : ""}
                              {setupFee && setupFee > 0 ? ` A one-time setup fee of ${formatUsd(setupFee)} is included.` : ""}
                              {minChargeApplied
                                ? ` A minimum charge of ${formatUsd(
                                    primaryPricing.min_charge ?? breakdownSubtotal ?? foamSubtotal,
                                  )} applies to this configuration.`
                                : ""}
                            </span>
                            <br />
                            Final billing may adjust if specs, quantities, or services change.
                          </>
                        ) : (
                          "Final billing may adjust if specs, quantities, or services change."
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                      Pricing is still being finalized for this quote. Once pricing is applied, the per-piece and subtotal
                      values will appear here and in the line items below.
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
                      <div style={{ fontSize: 13, color: "#111827", marginBottom: 4 }}>
                        A foam layout has been saved for this quote.
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, lineHeight: 1.4 }}>
                        You can open the layout editor from this page or from your emailed quote to adjust pocket locations
                        before finalizing.
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
                    <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                      No foam layout has been saved yet. Use the layout editor link in your emailed quote to place cavities
                      where you’d like your parts to sit, then click <strong>Apply to quote</strong> to store the layout
                      with this quote.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LINE ITEMS CARD (foam items + layers + carton selections) */}
            <div style={{ ...cardBase, background: "#ffffff", marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>Line items</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                These are the materials and quantities currently stored with your quote.
              </div>

              {items.length === 0 && requestedBoxes.length === 0 && layerDisplayRows.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>
                  No line items stored for this quote yet. Once the material and details are finalized, the primary line
                  will appear here.
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
                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Item</th>
                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>
                          Dimensions (L x W x H in)
                        </th>
                        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Qty</th>
                        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Unit price</th>
                        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Line total</th>
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
                        const dims = `${formatDims(item.length_in, item.width_in, item.height_in)} in`;

                        const baseLabel = item.material_name || "Material #" + item.material_id;

                        const subParts: string[] = [];
                        if (item.material_family) subParts.push(item.material_family);
                        const densRaw = (item as any).density_lb_ft3;
                        const densNum = typeof densRaw === "number" ? densRaw : densRaw != null ? Number(densRaw) : NaN;
                        if (Number.isFinite(densNum) && densNum > 0) subParts.push(`${densNum.toFixed(1)} lb/ft³`);
                        const subLabel = subParts.length > 0 ? subParts.join(" · ") : null;

                        const unit = parsePriceField(item.price_unit_usd ?? null);
                        const total = parsePriceField(item.price_total_usd ?? null);

                        return (
                          <tr key={item.id}>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                              <div style={{ fontWeight: 500 }}>Line {idx + 1}</div>
                              <div style={{ color: "#6b7280" }}>
                                {baseLabel}
                                {subLabel && <div style={{ fontSize: 11, marginTop: 2 }}>{subLabel}</div>}
                              </div>
                            </td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{dims}</td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                              {item.qty}
                            </td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                              {formatUsd(unit)}
                            </td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                              {formatUsd(total)}
                            </td>
                          </tr>
                        );
                      })}

                      {/* Foam layers (display only, not priced separately) */}
                      {layerDisplayRows.map((layer) => (
                        <tr key={layer.key}>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                            <div style={{ fontWeight: 500 }}>Foam layer: {layer.name}</div>
                            <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
                              Layer details from saved layout (for reference; included in foam pricing above).
                            </div>
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{layer.dims}</td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>{layer.qty}</td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            {formatUsd(null)}
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            {formatUsd(null)}
                          </td>
                        </tr>
                      ))}

                      {/* Requested cartons appended as additional lines */}
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
                          (rb.description && rb.description.trim().length > 0 ? rb.description.trim() : `${rb.style || "Carton"}`) ||
                          "Carton";

                        const L = Number(rb.inside_length_in);
                        const W = Number(rb.inside_width_in);
                        const H = Number(rb.inside_height_in);

                        const dimsOk = Number.isFinite(L) && Number.isFinite(W) && Number.isFinite(H);
                        const dimsText = dimsOk ? `${formatDims(L, W, H)} in` : null;

                        const notesParts: string[] = [];
                        if (rb.sku) notesParts.push(`SKU: ${rb.sku}`);
                        // Vendor is intentionally NOT shown on client quote
                        if (dimsText) notesParts.push(`Inside ${dimsText}`);

                        const subLabel = notesParts.length > 0 ? notesParts.join(" · ") : null;

                        const dimsDisplay = dimsText ?? "—";
                        const qty = rb.qty || primaryItem?.qty || 1;

                        const unitPriceRaw =
                          (rb as any).unit_price_usd ?? (rb as any).base_unit_price ?? (rb as any).price_unit_usd ?? null;
                        const unitPrice = parsePriceField(unitPriceRaw);

                        const lineTotalRaw =
                          (rb as any).extended_price_usd ??
                          (rb as any).line_total_usd ??
                          (unitPrice != null ? unitPrice * qty : null);
                        const lineTotal = parsePriceField(lineTotalRaw);

                        const isRemoving = removingBoxId === rb.id;

                        return (
                          <tr key={`carton-${rb.id}`}>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
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
                                  <div style={{ fontWeight: 500 }}>{mainLabel}</div>
                                  {subLabel && <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{subLabel}</div>}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCarton(rb.id)}
                                  disabled={isRemoving}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    border: "1px solid #fecaca",
                                    background: isRemoving ? "#fee2e2" : "#fef2f2",
                                    color: "#b91c1c",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: isRemoving ? "default" : "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {isRemoving ? "Removing…" : "✕ Remove"}
                                </button>
                              </div>
                            </td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{dimsDisplay}</td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>{qty}</td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                              {formatUsd(unitPrice)}
                            </td>
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                              {formatUsd(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>Total quantity</div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{overallQty}</div>
                      {anyPricing && (
                        <>
                          {/* Foam subtotal always shown */}
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>Foam subtotal</div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{formatUsd(foamSubtotal)}</div>

                          {/* Packaging subtotal only if cartons are priced */}
                          {effectivePackagingSubtotal > 0 && (
                            <>
                              <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>Packaging subtotal</div>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{formatUsd(effectivePackagingSubtotal)}</div>

                              <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
                                Estimated subtotal (foam + packaging)
                              </div>
                              <div style={{ fontSize: 16, fontWeight: 600 }}>{formatUsd(effectiveGrandSubtotal)}</div>
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
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Foam layout package</div>

              <div style={{ ...cardBase, background: "#ffffff" }}>
                {!layoutPkg ? (
                  <p style={{ color: "#6b7280", fontSize: 13 }}>
                    No foam layout has been saved for this quote yet. Use the <strong>Open layout preview</strong> button
                    in the emailed quote to arrange cavities, then click <strong>Apply to quote</strong> to store the
                    layout here.
                  </p>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "#111827", marginBottom: 2 }}>Layout package #{layoutPkg.id}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>Saved: {new Date(layoutPkg.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12 }}>
                        <a
                          href={"/quote/layout?quote_no=" + encodeURIComponent(quote.quote_no)}
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
                      <div style={{ marginTop: 6, color: "#4b5563", fontSize: 12 }}>
                        <span style={{ fontWeight: 500 }}>Notes: </span>
                        {notesPreview}
                      </div>
                    )}

                    {/* Per-layer previews (no CAD downloads) */}
                    {(() => {
                      if (!layoutPkg.layout_json) return null;

                      let json: any = layoutPkg.layout_json;
                      if (typeof json === "string") {
                        try {
                          json = JSON.parse(json);
                        } catch {
                          return null;
                        }
                      }

                      if (!layersForPreview || layersForPreview.length === 0) {
                        return (
                          <div
                            style={{
                              marginTop: 10,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid #e5e7eb",
                              background: "#ffffff",
                              fontSize: 12,
                              color: "#6b7280",
                            }}
                          >
                            Layout saved, but no layers were found to preview.
                          </div>
                        );
                      }

                      return (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Layers (preview)</div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                              gap: 12,
                            }}
                          >
                            {layersForPreview.map((layer, idx) => {
                              const label = getLayerLabel(layer, idx);
                              const t = getLayerThicknessInFromLayout(json, idx);

                              const depthSummary = getPocketDepthSummary(json, idx);
                              const svg = buildSvgPreviewForLayer(json, idx);
                              const isSelected = idx === selectedLayerIdx;

                              return (
                                <div
                                  key={idx}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedLayerIdx(idx)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setSelectedLayerIdx(idx);
                                    }
                                  }}
                                  style={{
                                    border: isSelected ? "2px solid #0ea5e9" : "1px solid #e5e7eb",
                                    borderRadius: 14,
                                    padding: 10,
                                    background: "#ffffff",
                                    boxShadow: isSelected ? "0 10px 22px rgba(14,165,233,0.20)" : "0 6px 16px rgba(15,23,42,0.06)",
                                    cursor: "pointer",
                                    outline: "none",
                                  }}
                                  title="Click to focus this layer"
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{label}</div>
                                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                                        {t ? `Thickness: ${t.toFixed(3)} in` : "Thickness: —"}
                                      </div>
                                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                                        {depthSummary ? `Pocket depth: ${depthSummary}` : "Pocket depth: —"}
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>
                                      Layer {idx + 1}/{layersForPreview.length}
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      marginTop: 8,
                                      height: 160,
                                      borderRadius: 10,
                                      border: "1px solid #e5e7eb",
                                      background: "#f3f4f6",
                                      overflow: "hidden",
                                    }}
                                  >
                                    {svg ? (
                                      <div style={{ width: "100%", height: "100%", display: "flex" }} dangerouslySetInnerHTML={{ __html: svg }} />
                                    ) : (
                                      <div
                                        style={{
                                          height: "100%",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: 12,
                                          color: "#6b7280",
                                        }}
                                      >
                                        No preview
                                      </div>
                                    )}
                                  </div>

                                  <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
                                    Preview shows foam outline + cavity geometry for this layer.
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Large selected layer preview */}
                          <div
                            style={{
                              marginTop: 14,
                              padding: 8,
                              borderRadius: 10,
                              border: "1px solid #e5e7eb",
                              background: "#ffffff",
                            }}
                          >
                            {(() => {
                              const selIdx = selectedLayerIdx;
const t = getLayerThicknessInFromLayout(json, selIdx);
const depthSummary = getPocketDepthSummary(json, selIdx);


                              return (
                                <>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                                    Selected layer preview:{" "}
                                    <span style={{ fontWeight: 700 }}>
                                      {getLayerLabel(layersForPreview[selIdx] || null, selIdx)} (Layer{" "}
                                      {Math.min(selIdx + 1, layersForPreview.length)}/{layersForPreview.length})
                                    </span>

{t ? <span style={{ marginLeft: 10, color: "#6b7280" }}>• Thickness: {t.toFixed(3)} in</span> : null}


                                    {depthSummary ? (
                                      <span style={{ marginLeft: 10, color: "#6b7280" }}>• Pocket depth: {depthSummary}</span>
                                     
                                    ) : (
                                      <span style={{ marginLeft: 10, color: "#6b7280" }}>• Pocket depth: —</span>
                                    )}

                                    
                                  </div>

                                  <div
                                    style={{
                                      width: "100%",
                                      height: 360,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      borderRadius: 8,
                                      border: "1px solid #e5e7eb",
                                      background: "#f3f4f6",
                                      overflow: "hidden",
                                    }}
                                  >
                                    {(() => {
                                      const svg = buildSvgPreviewForLayer(json, selIdx);
                                      if (!svg) return <div style={{ fontSize: 12, color: "#6b7280" }}>No preview</div>;
                                      return (
                                        <div style={{ width: "100%", height: "100%", display: "flex" }} dangerouslySetInnerHTML={{ __html: svg }} />
                                      );
                                    })()}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>

            <p style={{ marginTop: 24, fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
              This print view mirrors the core specs of your emailed quote. Actual charges may differ if specs or
              quantities change or if additional services are requested.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
