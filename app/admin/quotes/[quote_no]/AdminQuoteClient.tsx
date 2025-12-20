// app/admin/quotes/[quote_no]/AdminQuoteClient.tsx
//
// Internal admin quote viewer:
//  - Uses quote_no from props when available.
//  - If props are missing, rescues quote_no from window.location.pathname
//    (/admin/quotes/<quote_no>).
//  - Calls /api/quote/print to fetch:
//      - quote header
//      - items
//      - latest layout package (including svg_text / dxf_text / step_text)
//  - Renders a layout + CAD download section intended for internal use.
//
// IMPORTANT:
//  - This is an INTERNAL view (engineering / estimating).
//  - Client-facing /quote page remains CAD-download-free.
//  - We DO NOT touch cavity parsing, dims, qty logic, or existing /quote UI.

"use client";

import * as React from "react";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
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

  // NEW: carry-through from /api/quote/print
  material_family?: string | null;
  density_lb_ft3?: number | null;

  price_unit_usd?: string | null;
  price_total_usd?: string | null;

  // NEW: richer pricing metadata from /api/quote/print
  pricing_meta?: {
    min_charge?: number | null;
    used_min_charge?: boolean;
    setup_fee?: number | null;
    kerf_pct?: number | null;
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
};

type ApiErr = {
  ok: false;
  error: string;
  message: string;
};

type ApiResponse = ApiOk | ApiErr;

type Props = {
  quoteNo?: string;
};

// NEW: requested cartons (quote_box_selections + boxes join) for this quote
type RequestedBoxRow = {
  id: number; // row id from quote_box_selections
  quote_id: number;
  box_id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  qty: number;
};

type BoxesForQuoteOk = {
  ok: true;
  selections: RequestedBoxRow[];
};

type BoxesForQuoteErr = {
  ok: false;
  error: string;
};

type BoxesForQuoteResponse = BoxesForQuoteOk | BoxesForQuoteErr;

function parsePriceField(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
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

/* ---------------- Filename helpers (manufacturer-friendly) ---------------- */

function sanitizeFilenamePart(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  // Replace illegal-ish characters with dashes and collapse repeats
  const cleaned = s
    .replace(/[\s]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  // Keep it readable, not monstrous
  return cleaned.length > 48 ? cleaned.slice(0, 48) : cleaned;
}

function formatThicknessForName(thicknessIn: number | null | undefined): string | null {
  if (thicknessIn == null) return null;
  const n = Number(thicknessIn);
  if (!Number.isFinite(n) || n <= 0) return null;

  // 1.250in format (trim trailing zeros)
  const fixed = n.toFixed(3);
  const trimmed = fixed.replace(/\.?0+$/g, "");
  return `${trimmed}in`;
}

function buildLayerFilename(opts: {
  quoteNo: string;
  layerIndex: number; // 0-based
  layerLabel: string | null;
  thicknessIn: number | null;
  ext: "dxf" | "step";
}): string {
  const q = sanitizeFilenamePart(opts.quoteNo || "quote");
  const layerNum = opts.layerIndex + 1;
  const label = sanitizeFilenamePart(opts.layerLabel || "");
  const thick = formatThicknessForName(opts.thicknessIn);

  const parts: string[] = [];
  parts.push(q);
  parts.push(`Layer-${layerNum}`);
  if (label) parts.push(label);
  if (thick) parts.push(thick);

  return `${parts.join("__")}.${opts.ext}`;
}

function buildFullPackageFilename(opts: { quoteNo: string; ext: "dxf" | "step" | "zip" }): string {
  const q = sanitizeFilenamePart(opts.quoteNo || "quote");
  return `${q}__Full-Package.${opts.ext}`;
}

/* ---------------- DXF helpers (per-layer) ---------------- */

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
  depthIn: number | null;
  x: number; // normalized 0..1
  y: number; // normalized 0..1

  // NEW (Path A): used only for admin per-layer preview clarity
  shape?: "rect" | "circle" | null;
  diameterIn?: number | null;
};

type TargetDimsIn = { L: number; W: number };

function getLayerThicknessInFromLayout(layout: any, layerIndex: number): number | null {
  if (!layout || typeof layout !== "object") return null;

  const candidates: any[] = [];

  const previewLayers = getLayersFromLayout(layout);
  if (previewLayers[layerIndex]) candidates.push(previewLayers[layerIndex]);

  if (Array.isArray(layout.layers) && layout.layers[layerIndex]) candidates.push(layout.layers[layerIndex]);
  if (Array.isArray(layout.stack) && layout.stack[layerIndex]) candidates.push(layout.stack[layerIndex]);
  if (Array.isArray((layout as any).foamLayers) && (layout as any).foamLayers[layerIndex]) {
    candidates.push((layout as any).foamLayers[layerIndex]);
  }

  for (const layer of candidates) {
    if (!layer) continue;

    const t =
      layer.thicknessIn ??
      layer.thickness_in ??
      layer.thickness ??
      layer.thicknessInches ??
      layer.thickness_inches ??
      layer.thickness_inch ??
      layer.heightIn ??
      layer.height_in ??
      null;

    const n = Number(t);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

/** Extract the stack/layers array from a layout_json */
function getLayersFromLayout(layout: any): LayoutLayer[] {
  if (!layout || typeof layout !== "object") return [];

  if (Array.isArray(layout.stack) && layout.stack.length > 0) {
    return layout.stack as LayoutLayer[];
  }
  if (Array.isArray(layout.layers) && layout.layers.length > 0) {
    return layout.layers as LayoutLayer[];
  }
  if (Array.isArray((layout as any).foamLayers) && (layout as any).foamLayers.length > 0) {
    return (layout.foamLayers as any[]) as LayoutLayer[];
  }

  return [];
}

function getLayerLabel(layer: LayoutLayer | null | undefined, idx: number): string {
  if (!layer) return `Layer ${idx + 1}`;

  // IMPORTANT: keep this neutral (numbers), no “top/middle/bottom” assumptions
  const raw = layer.label ?? layer.name ?? layer.title ?? null;

  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  return `Layer ${idx + 1}`;
}

function getLayerThicknessIn(layer: LayoutLayer | null | undefined): number | null {
  if (!layer) return null;
  const t = (layer.thicknessIn ?? layer.thickness_in ?? (layer as any).thickness ?? null) as any;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeShape(raw: any): "rect" | "circle" | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;

  if (s === "circle" || s === "round" || s === "circular") return "circle";
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";

  return null;
}

/** Flatten cavities for a single layer */
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
    const depthInRaw = (cav as any).depthIn;
    const depthIn = depthInRaw == null ? null : Number(depthInRaw);

    const x = Number((cav as any).x);
    const y = Number((cav as any).y);

    if (!Number.isFinite(lengthIn) || lengthIn <= 0) continue;

    const w = Number.isFinite(widthIn) && widthIn > 0 ? widthIn : lengthIn;

    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      continue;
    }

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
      depthIn: Number.isFinite(depthIn || NaN) ? depthIn : null,
      x,
      y,
      shape: shape ?? null,
      diameterIn: diameterIn ?? null,
    });
  }

  return out;
}

/* ---------------- UI helpers for layer pocket depth (admin previews) ---------------- */

function fmtIn(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(3)} in` : "—";
}

function getLayerPocketDepthSummary(layout: any, layerIndex: number): { text: string; hasMultiple: boolean } {
  const cavs = getCavitiesForLayer(layout, layerIndex);

  // Accept 0 as a valid depth (rare, but keeps us honest); ignore null/NaN.
  const depthsRaw = cavs
    .map((c) => (c.depthIn == null ? NaN : Number(c.depthIn)))
    .filter((d) => Number.isFinite(d) && d >= 0);

  if (depthsRaw.length === 0) return { text: "—", hasMultiple: false };

  // Normalize for uniqueness at 0.001 resolution (matches display precision)
  const rounded = depthsRaw.map((d) => Math.round(d * 1000) / 1000);
  const uniq = Array.from(new Set(rounded)).sort((a, b) => a - b);

  if (uniq.length === 1) return { text: fmtIn(uniq[0]), hasMultiple: false };

  const min = uniq[0];
  const max = uniq[uniq.length - 1];
  return { text: `${min.toFixed(3)}–${max.toFixed(3)} in`, hasMultiple: true };
}

/**
 * Build a DXF for a single layer:
 *  - Foam block as rectangle from (0,0) to (L,W)
 *  - Cavities in that layer as rects or circles (when shape === "circle")
 *
 * IMPORTANT:
 * - Some layouts store block dimensions in a different internal unit.
 * - If targetDimsIn is provided (from the quote primary item), we apply a uniform
 *   scale so the DXF measures correctly in inches while preserving geometry.
 */
function buildDxfForLayer(layout: any, layerIndex: number, targetDimsIn?: TargetDimsIn): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  const rawL = Number(block.lengthIn ?? block.length_in);
  const rawW = Number(block.widthIn ?? block.width_in);

  if (!Number.isFinite(rawL) || rawL <= 0) return null;
  const fallbackW = Number.isFinite(rawW) && rawW > 0 ? rawW : rawL;

  // Uniform scale: prefer using target L when available; keeps circles circular.
  let scale = 1;
  if (
    targetDimsIn &&
    Number.isFinite(targetDimsIn.L) &&
    targetDimsIn.L > 0 &&
    Number.isFinite(rawL) &&
    rawL > 0
  ) {
    scale = targetDimsIn.L / rawL;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  }

  const L = rawL * scale;
  const W = fallbackW * scale;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
    return [
      "0",
      "LINE",
      "8",
      "0",
      "10",
      fmt(x1),
      "20",
      fmt(y1),
      "30",
      "0.0",
      "11",
      fmt(x2),
      "21",
      fmt(y2),
      "31",
      "0.0",
    ].join("\n");
  }

  const entities: string[] = [];

  // 1) Block rectangle
  entities.push(lineEntity(0, 0, L, 0));
  entities.push(lineEntity(L, 0, L, W));
  entities.push(lineEntity(L, W, 0, W));
  entities.push(lineEntity(0, W, 0, 0));

  // 2) Layer-specific cavities (normalized x/y → inches)
  const cavs = getCavitiesForLayer(layout, layerIndex);

  for (const cav of cavs) {
    const cL = cav.lengthIn;
    const cW = cav.widthIn;

    // X is consistent (0 = left). Y must be flipped to match SVG/editor:
    // SVG: y grows downward from top
    // DXF: y grows upward from bottom
    const x0 = L * cav.x;

    const ySvgTop = W * cav.y;
    const y0 = W - ySvgTop - cW; // flip + keep cavity height in-bounds

    // Defensive clamp (keep inside block)
    const left = Math.max(0, Math.min(L - cL, x0));
    const bottom = Math.max(0, Math.min(W - cW, y0));

    // If circle, output a CIRCLE entity. Otherwise, rectangle lines.
    if (cav.shape === "circle") {
      const dia =
        cav.diameterIn != null && Number.isFinite(cav.diameterIn) && cav.diameterIn > 0
          ? cav.diameterIn
          : Math.min(cL, cW);

      const r = Math.max(0, dia / 2);
      const cx = left + cL / 2;
      const cy = bottom + cW / 2;

      entities.push(
        [
          "0",
          "CIRCLE",
          "8",
          "0",
          "10",
          fmt(cx),
          "20",
          fmt(cy),
          "30",
          "0.0",
          "40",
          fmt(r),
        ].join("\n"),
      );
      continue;
    }

    // Rect (default)
    entities.push(lineEntity(left, bottom, left + cL, bottom));
    entities.push(lineEntity(left + cL, bottom, left + cL, bottom + cW));
    entities.push(lineEntity(left + cL, bottom + cW, left, bottom + cW));
    entities.push(lineEntity(left, bottom + cW, left, bottom));
  }

  if (!entities.length) return null;

  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    "1", // inches
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ].join("\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\n");

  return [header, entities.join("\n"), footer].join("\n");
}

/**
 * NEW: Build a "Full Package" DXF on-demand (client-side) using the SAME
 * scale/orientation logic as buildDxfForLayer, but combining cavities from ALL layers.
 *
 * This intentionally bypasses layoutPkg.dxf_text (which is currently mis-scaled).
 */
function buildDxfForFullPackage(layout: any, targetDimsIn?: TargetDimsIn): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  const rawL = Number(block.lengthIn ?? block.length_in);
  const rawW = Number(block.widthIn ?? block.width_in);

  if (!Number.isFinite(rawL) || rawL <= 0) return null;
  const fallbackW = Number.isFinite(rawW) && rawW > 0 ? rawW : rawL;

  let scale = 1;
  if (
    targetDimsIn &&
    Number.isFinite(targetDimsIn.L) &&
    targetDimsIn.L > 0 &&
    Number.isFinite(rawL) &&
    rawL > 0
  ) {
    scale = targetDimsIn.L / rawL;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  }

  const L = rawL * scale;
  const W = fallbackW * scale;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
    return [
      "0",
      "LINE",
      "8",
      "0",
      "10",
      fmt(x1),
      "20",
      fmt(y1),
      "30",
      "0.0",
      "11",
      fmt(x2),
      "21",
      fmt(y2),
      "31",
      "0.0",
    ].join("\n");
  }

  const entities: string[] = [];

  // Block rectangle
  entities.push(lineEntity(0, 0, L, 0));
  entities.push(lineEntity(L, 0, L, W));
  entities.push(lineEntity(L, W, 0, W));
  entities.push(lineEntity(0, W, 0, 0));

  const layers = getLayersFromLayout(layout);

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const cavs = getCavitiesForLayer(layout, layerIndex);

    for (const cav of cavs) {
      const cL = cav.lengthIn;
      const cW = cav.widthIn;

      const x0 = L * cav.x;

      const ySvgTop = W * cav.y;
      const y0 = W - ySvgTop - cW;

      const left = Math.max(0, Math.min(L - cL, x0));
      const bottom = Math.max(0, Math.min(W - cW, y0));

      if (cav.shape === "circle") {
        const dia =
          cav.diameterIn != null && Number.isFinite(cav.diameterIn) && cav.diameterIn > 0
            ? cav.diameterIn
            : Math.min(cL, cW);

        const r = Math.max(0, dia / 2);
        const cx = left + cL / 2;
        const cy = bottom + cW / 2;

        entities.push(
          [
            "0",
            "CIRCLE",
            "8",
            "0",
            "10",
            fmt(cx),
            "20",
            fmt(cy),
            "30",
            "0.0",
            "40",
            fmt(r),
          ].join("\n"),
        );
        continue;
      }

      entities.push(lineEntity(left, bottom, left + cL, bottom));
      entities.push(lineEntity(left + cL, bottom, left + cL, bottom + cW));
      entities.push(lineEntity(left + cL, bottom + cW, left, bottom + cW));
      entities.push(lineEntity(left, bottom + cW, left, bottom));
    }
  }

  if (!entities.length) return null;

  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    "1", // inches
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ].join("\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\n");

  return [header, entities.join("\n"), footer].join("\n");
}

/* ---------------- Lightweight SVG preview (per-layer, client-side) ---------------- */
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

      const w = c.lengthIn;
      const h = c.widthIn;

      const x2 = Math.max(0, Math.min(L, left));
      const y2 = Math.max(0, Math.min(W, top));
      const w2 = Math.max(0, Math.min(L - x2, w));
      const h2 = Math.max(0, Math.min(W - y2, h));
      if (w2 <= 0 || h2 <= 0) return "";

      if (c.shape === "circle") {
        const dia =
          c.diameterIn != null && Number.isFinite(c.diameterIn) && c.diameterIn > 0
            ? c.diameterIn
            : Math.min(w2, h2);
        const r = Math.max(0, Math.min(dia / 2, Math.min(w2, h2) / 2));
        if (r <= 0) return "";

        const cx = x2 + w2 / 2;
        const cy = y2 + h2 / 2;

        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
      }

      // ---- roundedRect support (Path A, admin preview only) ----
// FlatCavity typing in admin may be narrower than runtime layout cavities.
// Use safe runtime reads (no global type changes).
const shape = String((c as any)?.shape ?? "rect");
const cornerRadiusInRaw = Number((c as any)?.cornerRadiusIn ?? 0);

// Clamp radius so SVG is valid
const r = Number.isFinite(cornerRadiusInRaw) && cornerRadiusInRaw > 0
  ? Math.max(0, Math.min(cornerRadiusInRaw, w2 / 2, h2 / 2))
  : 0;

if (shape === "roundedRect" || r > 0) {
  // Only emit rx/ry when > 0
  if (r > 0) {
    return `<rect x="${x2}" y="${y2}" width="${w2}" height="${h2}" rx="${r}" ry="${r}" fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
  }
}

// default rect (includes legacy "rect")
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

/* ---------------- Component ---------------- */

export default function AdminQuoteClient({ quoteNo }: Props) {
  const [quoteNoValue, setQuoteNoValue] = React.useState<string>(quoteNo || "");

  const [loading, setLoading] = React.useState<boolean>(!!quoteNoValue);
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState<string | null>(null);
  const [quoteState, setQuoteState] = React.useState<QuoteRow | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(null);

  const [refreshTick, setRefreshTick] = React.useState<number>(0);

  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  const [boxSelections, setBoxSelections] = React.useState<RequestedBoxRow[] | null>(null);
  const [boxSelectionsLoading, setBoxSelectionsLoading] = React.useState<boolean>(false);
  const [boxSelectionsError, setBoxSelectionsError] = React.useState<string | null>(null);

  const [rebuildBusy, setRebuildBusy] = React.useState<boolean>(false);
  const [rebuildError, setRebuildError] = React.useState<string | null>(null);
  const [rebuildOkAt, setRebuildOkAt] = React.useState<string | null>(null);

  // NEW: Zip all-layers downloader state
  const [zipBusy, setZipBusy] = React.useState<boolean>(false);
  const [zipError, setZipError] = React.useState<string | null>(null);
  const [zipOkAt, setZipOkAt] = React.useState<string | null>(null);

  const [selectedLayerIdx, setSelectedLayerIdx] = React.useState<number>(0);

  React.useEffect(() => {
    if (quoteNoValue) return;
    if (typeof window === "undefined") return;

    try {
      const path = window.location.pathname || "";
      const parts = path.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "quotes");
      const fromPath = idx >= 0 && parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : "";

      if (fromPath) {
        setQuoteNoValue(fromPath);
        setLoading(true);
        setNotFound(null);
        setError(null);
      } else {
        setLoading(false);
        setNotFound("No quote number provided in the URL.");
      }
    } catch {
      setLoading(false);
      setNotFound("No quote number provided in the URL.");
    }
  }, [quoteNoValue]);

  React.useEffect(() => {
    if (!quoteNoValue) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(null);
      setQuoteState(null);
      setItems([]);
      setLayoutPkg(null);

      try {
        const res = await fetch("/api/quote/print?quote_no=" + encodeURIComponent(quoteNoValue), {
          cache: "no-store",
        });

        const json = (await res.json()) as ApiResponse;

        if (!res.ok) {
          if (!cancelled) {
            if (!json.ok && json.error === "NOT_FOUND") {
              setNotFound(json.message || "Quote not found.");
            } else if (!json.ok) {
              setError(json.message || "There was a problem loading this quote.");
            } else {
              setError("There was a problem loading this quote.");
            }
          }
          return;
        }

        if (!cancelled) {
          if (json.ok) {
            setQuoteState(json.quote);
            setItems(json.items || []);
            setLayoutPkg(json.layoutPkg || null);
          } else {
            setError("Unexpected response from quote API.");
          }
        }
      } catch (err) {
        console.error("Error fetching /api/quote/print (admin view):", err);
        if (!cancelled) {
          setError("There was an unexpected problem loading this quote. Please try again.");
        }
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
  }, [quoteNoValue, refreshTick]);

  React.useEffect(() => {
    if (!quoteNoValue) return;

    let cancelled = false;

    async function loadRequestedBoxes() {
      setBoxSelectionsLoading(true);
      setBoxSelectionsError(null);
      setBoxSelections(null);

      try {
        const res = await fetch("/api/boxes/for-quote?quote_no=" + encodeURIComponent(quoteNoValue), {
          cache: "no-store",
        });

        const json = (await res.json()) as BoxesForQuoteResponse;

        if (!res.ok || !json.ok) {
          if (!cancelled) {
            const msg =
              (!json.ok && (json as BoxesForQuoteErr).error) || "Unable to load requested cartons for this quote.";
            setBoxSelectionsError(msg);
          }
          return;
        }

        if (!cancelled) {
          setBoxSelections(json.selections || []);
        }
      } catch (err) {
        console.error("Error fetching /api/boxes/for-quote (admin view):", err);
        if (!cancelled) {
          setBoxSelectionsError("Unable to load requested cartons for this quote.");
        }
      } finally {
        if (!cancelled) {
          setBoxSelectionsLoading(false);
        }
      }
    }

    loadRequestedBoxes();

    return () => {
      cancelled = true;
    };
  }, [quoteNoValue]);

  const overallQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  const subtotal = items.reduce((sum, i) => {
    const lineTotal = parsePriceField(i.price_total_usd ?? null) ?? 0;
    return sum + lineTotal;
  }, 0);

  const anyPricing = subtotal > 0;

  const notesPreview =
    layoutPkg && layoutPkg.notes && layoutPkg.notes.trim().length > 0
      ? layoutPkg.notes.trim().length > 160
        ? layoutPkg.notes.trim().slice(0, 160) + "..."
        : layoutPkg.notes.trim()
      : null;

  React.useEffect(() => {
    if (!layoutPkg) return;
    if (!svgContainerRef.current) return;

    const svgEl = svgContainerRef.current.querySelector("svg") as SVGSVGElement | null;
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
      console.warn("Admin: could not normalize SVG preview:", e);
    }
  }, [layoutPkg]);

  const primaryItem = items[0] || null;

  const primaryPricing = primaryItem?.pricing_meta || null;
  const minChargeApplied = !!primaryPricing?.used_min_charge;
  const setupFee = typeof primaryPricing?.setup_fee === "number" ? primaryPricing.setup_fee : null;
  const kerfPct = typeof primaryPricing?.kerf_pct === "number" ? primaryPricing.kerf_pct : null;
  const minChargeValue = typeof primaryPricing?.min_charge === "number" ? primaryPricing.min_charge : null;

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

  const primaryMaterialName =
    primaryItem?.material_name || (primaryItem ? `Material #${primaryItem.material_id}` : null);
  const primaryMaterialFamily = primaryItem?.material_family || null;
  const rawPrimaryDensity = primaryItem?.density_lb_ft3 ?? null;
  const primaryDensity = rawPrimaryDensity != null ? Number(rawPrimaryDensity) : null;
  const primaryDensityDisplay = primaryDensity != null && Number.isFinite(primaryDensity) ? primaryDensity.toFixed(2) : null;

  const customerQuoteUrl =
    quoteState?.quote_no && typeof window === "undefined"
      ? `/quote?quote_no=${encodeURIComponent(quoteState.quote_no)}`
      : quoteState?.quote_no
        ? `/quote?quote_no=${encodeURIComponent(quoteState.quote_no)}`
        : null;

  const layersForDxf = React.useMemo(
    () => (layoutPkg && layoutPkg.layout_json ? getLayersFromLayout(layoutPkg.layout_json) : []),
    [layoutPkg],
  );

  React.useEffect(() => {
    const n = layersForDxf?.length || 0;
    if (n <= 0) {
      setSelectedLayerIdx(0);
      return;
    }
    setSelectedLayerIdx((prev) => {
      if (prev < 0) return 0;
      if (prev >= n) return 0;
      return prev;
    });
  }, [layersForDxf]);

  function getTargetDims(): TargetDimsIn | undefined {
    const targetL = primaryItem ? Number(primaryItem.length_in) : NaN;
    const targetW = primaryItem ? Number(primaryItem.width_in) : NaN;
    const targetDims =
      Number.isFinite(targetL) && targetL > 0 && Number.isFinite(targetW) && targetW > 0
        ? ({ L: targetL, W: targetW } as TargetDimsIn)
        : undefined;
    return targetDims;
  }

  function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const handleDownloadSvg = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (!layoutPkg?.svg_text) return;

    try {
      const blob = new Blob([layoutPkg.svg_text], { type: "image/svg+xml" });
      const baseName = quoteState?.quote_no || "quote";
      const filename = `${sanitizeFilenamePart(baseName)}__Full-Package.svg`;
      triggerBlobDownload(blob, filename);
    } catch (err) {
      console.error("Admin: SVG download failed:", err);
    }
  }, [layoutPkg, quoteState]);

  const handleDownloadFullPackageDxf = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (!layoutPkg || !layoutPkg.layout_json) return;

    const targetDims = getTargetDims();
    const dxf = buildDxfForFullPackage(layoutPkg.layout_json, targetDims);
    if (!dxf) return;

    try {
      const blob = new Blob([dxf], { type: "application/dxf" });
      const baseName = quoteState?.quote_no || "quote";
      const filename = buildFullPackageFilename({ quoteNo: baseName, ext: "dxf" });
      triggerBlobDownload(blob, filename);
    } catch (err) {
      console.error("Admin: full package DXF download failed:", err);
    }
  }, [layoutPkg, quoteState, primaryItem]);

  const handleDownloadStep = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!quoteNoValue) return;

    const url = `/api/quote/layout/step?quote_no=${encodeURIComponent(quoteNoValue)}`;

    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error("Admin: STEP fetch failed:", res.status, res.statusText);
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "application/octet-stream" });

      const baseName = quoteState?.quote_no || quoteNoValue || "quote";
      const filename = buildFullPackageFilename({ quoteNo: baseName, ext: "step" });

      triggerBlobDownload(blob, filename);
    } catch (err) {
      console.error("Admin: STEP download failed:", err);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [quoteNoValue, quoteState]);

  const handleDownloadLayerStep = React.useCallback(
    async (layerIndex: number, layerLabel: string | null, thicknessIn: number | null) => {
      if (typeof window === "undefined") return;
      if (!quoteNoValue) return;

      const url = `/api/quote/layout/step-layer?quote_no=${encodeURIComponent(
        quoteNoValue,
      )}&layer_index=${encodeURIComponent(String(layerIndex))}`;

      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          console.error("Admin: layer STEP fetch failed:", res.status, res.statusText);
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        const buf = await res.arrayBuffer();
        const blob = new Blob([buf], { type: "application/octet-stream" });

        const baseName = quoteState?.quote_no || quoteNoValue || "quote";
        const filename = buildLayerFilename({
          quoteNo: baseName,
          layerIndex,
          layerLabel,
          thicknessIn,
          ext: "step",
        });

        triggerBlobDownload(blob, filename);
      } catch (err) {
        console.error("Admin: layer STEP download failed:", err);
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [quoteNoValue, quoteState],
  );

  const handleDownloadLayerDxf = React.useCallback(
    (layerIndex: number, layerLabel: string | null, thicknessIn: number | null) => {
      if (typeof window === "undefined") return;
      if (!layoutPkg || !layoutPkg.layout_json) return;

      const targetDims = getTargetDims();
      const dxf = buildDxfForLayer(layoutPkg.layout_json, layerIndex, targetDims);
      if (!dxf) return;

      try {
        const blob = new Blob([dxf], { type: "application/dxf" });
        const baseName = quoteState?.quote_no || quoteNoValue || "quote";

        const filename = buildLayerFilename({
          quoteNo: baseName,
          layerIndex,
          layerLabel,
          thicknessIn,
          ext: "dxf",
        });

        triggerBlobDownload(blob, filename);
      } catch (err) {
        console.error("Admin: layer DXF download failed:", err);
      }
    },
    [layoutPkg, quoteState, primaryItem, quoteNoValue],
  );

  // NEW: Download all layers (DXF + STEP) as one ZIP
  const handleDownloadAllLayersZip = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!layoutPkg?.layout_json) return;
    if (!quoteNoValue) return;
    if (zipBusy) return;

    setZipBusy(true);
    setZipError(null);
    setZipOkAt(null);

    try {
      const baseName = quoteState?.quote_no || quoteNoValue || "quote";
      const layers = getLayersFromLayout(layoutPkg.layout_json);
      if (!layers || layers.length === 0) {
        setZipError("No layers found in this layout package.");
        return;
      }

      // Dynamic import keeps bundle lighter and avoids SSR issues.
      const mod: any = await import("jszip");
      const JSZipCtor = mod?.default || mod;
      const zip = new JSZipCtor();

      const targetDims = getTargetDims();

      // Create a friendly folder
      const folderName = `${sanitizeFilenamePart(baseName)}__Layers`;
      const root = zip.folder(folderName) || zip;

      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const label = getLayerLabel(layer, i);

        // IMPORTANT (Path A): thickness may live outside the chosen preview array (e.g., stack vs layers),
        // so resolve thickness directly from the full layout payload.
        const thicknessIn = getLayerThicknessInFromLayout(layoutPkg.layout_json, i);

        // DXF (client-generated, trusted)
        const dxf = buildDxfForLayer(layoutPkg.layout_json, i, targetDims);
        if (dxf) {
          const dxfName = buildLayerFilename({
            quoteNo: baseName,
            layerIndex: i,
            layerLabel: label,
            thicknessIn,
            ext: "dxf",
          });
          root.file(dxfName, dxf);
        }

        // STEP (server-generated via microservice route)
        const stepUrl = `/api/quote/layout/step-layer?quote_no=${encodeURIComponent(
          quoteNoValue,
        )}&layer_index=${encodeURIComponent(String(i))}`;

        try {
          const res = await fetch(stepUrl, { cache: "no-store" });
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const stepName = buildLayerFilename({
              quoteNo: baseName,
              layerIndex: i,
              layerLabel: label,
              thicknessIn,
              ext: "step",
            });
            root.file(stepName, buf);
          } else {
            // Don’t fail the whole zip—just include a note.
            const noteName = `Layer-${i + 1}__STEP-FAILED.txt`;
            root.file(noteName, `STEP download failed (HTTP ${res.status}) for layer ${i + 1}.`);
          }
        } catch (e: any) {
          const noteName = `Layer-${i + 1}__STEP-FAILED.txt`;
          root.file(noteName, `STEP download failed for layer ${i + 1}: ${String(e?.message ?? e)}`);
        }
      }

      // Add a tiny manifest (nice for manufacturers)
      const manifestLines: string[] = [];
      manifestLines.push(`Quote: ${baseName}`);
      manifestLines.push(`Generated: ${new Date().toLocaleString()}`);
      manifestLines.push(`Layers: ${layers.length}`);
      manifestLines.push("");
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const label = getLayerLabel(layer, i);
        const thicknessIn = getLayerThicknessInFromLayout(layoutPkg.layout_json, i);
        const thick = formatThicknessForName(thicknessIn) || "—";
        manifestLines.push(`Layer ${i + 1}: ${label} (thickness ${thick})`);
      }
      root.file("MANIFEST.txt", manifestLines.join("\n"));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = buildFullPackageFilename({ quoteNo: baseName, ext: "zip" });

      triggerBlobDownload(zipBlob, zipName);

      setZipOkAt(new Date().toLocaleString());
    } catch (e: any) {
      console.error("Admin: zip build failed:", e);
      setZipError(String(e?.message ?? e));
    } finally {
      setZipBusy(false);
    }
  }, [layoutPkg, quoteNoValue, quoteState, zipBusy, primaryItem]);

  const handleRebuildStepNow = React.useCallback(async () => {
    if (!quoteNoValue) return;
    if (rebuildBusy) return;

    setRebuildBusy(true);
    setRebuildError(null);
    setRebuildOkAt(null);

    try {
      const res = await fetch("/api/quote/layout/rebuild-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ quote_no: quoteNoValue }),
      });

      const ct = res.headers.get("content-type") || "";
      let json: any = null;

      if (ct.includes("application/json")) {
        json = await res.json();
      } else {
        const text = await res.text();
        json = { ok: res.ok, message: text };
      }

      if (!res.ok || !json?.ok) {
        setRebuildError(json?.error || json?.message || "Rebuild failed.");
        return;
      }

      setRebuildOkAt(new Date().toLocaleString());
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      console.error("Admin: rebuild-step failed:", e);
      setRebuildError(String(e?.message ?? e));
    } finally {
      setRebuildBusy(false);
    }
  }, [quoteNoValue, rebuildBusy]);

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
          maxWidth: "1100px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "24px",
          padding: "24px 24px 32px 24px",
          boxShadow: "0 16px 40px rgba(15,23,42,0.45)",
        }}
      >
        {/* Back link to quotes list */}
        <div style={{ marginBottom: 8 }}>
          <a
            href="/admin/quotes"
            style={{
              fontSize: 11,
              color: "#0284c7",
              textDecoration: "none",
            }}
          >
            ← Back to quotes list
          </a>
        </div>

        {/* Header */}
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
              Alex-IO internal
            </div>
            <div
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              Admin layout & CAD view
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                opacity: 0.94,
              }}
            >
              Quote {quoteNoValue || "—"}
            </div>
          </div>

          <div
            style={{
              textAlign: "right",
              fontSize: 12,
              color: "#e5e7eb",
            }}
          >
            {quoteState && (
              <>
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
                  {quoteState.status.toUpperCase()}
                </div>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: 11,
                    opacity: 0.9,
                  }}
                >
                  Created: {new Date(quoteState.created_at).toLocaleString()}
                </p>
              </>
            )}
          </div>
        </div>

        {/* loading / errors */}
        {loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Loading quote...</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>Fetching quote + latest foam layout package.</p>
          </>
        )}

        {!loading && notFound && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#555" }}>{notFound}</p>
          </>
        )}

        {!loading && error && !quoteState && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Problem loading quote</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>{error}</p>
          </>
        )}

        {/* main content */}
        {!loading && quoteState && (
          <>
            {/* top row: basic specs + quick pricing snapshot */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,2.2fr) minmax(0,1.8fr)",
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div style={cardBase}>
                <div style={cardTitleStyle}>Client & specs</div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    color: "#111827",
                  }}
                >
                  <div>
                    <div style={labelStyle}>Customer</div>
                    <div>
                      {quoteState.customer_name}
                      {quoteState.email ? <> • {quoteState.email}</> : null}
                      {quoteState.phone ? <> • {quoteState.phone}</> : null}
                    </div>
                  </div>
                  {primaryItem && (
                    <>
                      <div>
                        <div style={labelStyle}>Primary dims (L × W × H)</div>
                        <div>
                          {primaryItem.length_in} × {primaryItem.width_in} × {primaryItem.height_in} in
                        </div>
                      </div>
                      <div>
                        <div style={labelStyle}>Primary material</div>
                        <div>{primaryItem.material_name || `Material #${primaryItem.material_id}`}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Quoted quantity</div>
                        <div>{primaryItem.qty.toLocaleString()}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={cardBase}>
                <div style={cardTitleStyle}>Pricing snapshot</div>
                {items.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    No stored line items yet. Once quote_items are written, you&apos;ll see per-line pricing here.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      color: "#111827",
                    }}
                  >
                    <div>
                      <div style={labelStyle}>Lines</div>
                      <div>{items.length}</div>
                    </div>
                    <div>
                      <div style={labelStyle}>Total quantity</div>
                      <div>{overallQty}</div>
                    </div>
                    {anyPricing && (
                      <>
                        <div>
                          <div style={labelStyle}>Estimated subtotal</div>
                          <div style={{ fontSize: 16, fontWeight: 600 }}>{formatUsd(subtotal)}</div>
                        </div>
                        {primaryItem && (
                          <div>
                            <div style={labelStyle}>Primary unit price</div>
                            <div>{formatUsd(parsePriceField(primaryItem.price_unit_usd ?? null))}</div>
                          </div>
                        )}
                        {primaryPricing && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
                            <span>
                              Calc basis: volumetric foam charge with{" "}
                              {typeof kerfPct === "number" ? `~${kerfPct}% kerf/waste` : "standard kerf/waste"}.{" "}
                              {setupFee && setupFee > 0 ? ` Includes a setup fee of ${formatUsd(setupFee)}.` : ""}
                              {minChargeApplied
                                ? ` Pricing is currently governed by the minimum charge (${formatUsd(
                                    minChargeValue ?? subtotal,
                                  )}), not the raw volume math.`
                                : " Minimum charge is not the limiting factor for this configuration."}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {!anyPricing && (
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                        Volumetric calc did not attach pricing. Check material / dims / qty if you expect a value here.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Materials explorer + "view customer quote" */}
            {primaryItem && (
              <div
                style={{
                  ...cardBase,
                  background: "#ffffff",
                  marginBottom: 20,
                  display: "grid",
                  gridTemplateColumns: "minmax(0,2.2fr) minmax(0,1.8fr)",
                  gap: 16,
                }}
              >
                <div>
                  <div style={cardTitleStyle}>Materials explorer</div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#111827",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div>
                      <div style={labelStyle}>Primary material</div>
                      <div>{primaryMaterialName}</div>
                    </div>
                    <div>
                      <div style={labelStyle}>Family</div>
                      <div>
                        {primaryMaterialFamily || (
                          <span style={{ color: "#9ca3af" }}>Unassigned (set in materials admin)</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Density</div>
                      <div>{primaryDensityDisplay != null ? `${primaryDensityDisplay} pcf` : "—"}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      Family + density come directly from the{" "}
                      <span
                        style={{
                          fontFamily: "ui-monospace, SFMono-Regular, monospace",
                          fontSize: 11,
                          color: "#0369a1",
                        }}
                      >
                        materials
                      </span>{" "}
                      table. Polyethylene and Expanded Polyethylene remain separate families.
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 12,
                    color: "#111827",
                  }}
                >
                  <div>
                    <div style={labelStyle}>Admin shortcuts</div>
                    <ul
                      style={{
                        listStyle: "disc",
                        paddingLeft: 18,
                        marginTop: 4,
                        marginBottom: 4,
                        color: "#1f2937",
                        fontSize: 12,
                      }}
                    >
                      <li>
                        <a href="/admin/materials" style={{ color: "#0369a1", textDecoration: "none" }}>
                          Open materials catalog
                        </a>{" "}
                        to confirm family / density.
                      </li>
                      <li>
                        <a
                          href={`/admin/cushion-curves/${primaryItem.material_id}`}
                          style={{ color: "#0369a1", textDecoration: "none" }}
                        >
                          View cushion curves for this material
                        </a>{" "}
                        (foam advisor data).
                      </li>
                    </ul>
                  </div>

                  {customerQuoteUrl && (
                    <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px dashed #e5e7eb" }}>
                      <div style={labelStyle}>Customer-facing view</div>
                      <a
                        href={customerQuoteUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 2,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid #0ea5e9",
                          background: "#e0f2fe",
                          color: "#0369a1",
                          fontSize: 11,
                          fontWeight: 500,
                          textDecoration: "none",
                        }}
                      >
                        View customer quote in new tab <span aria-hidden="true">↗</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Customer requested cartons */}
            <div style={{ ...cardBase, background: "#ffffff", marginBottom: 20 }}>
              <div style={cardTitleStyle}>Customer requested cartons</div>
              {boxSelectionsLoading && (
                <p style={{ fontSize: 12, color: "#6b7280" }}>
                  Looking up any cartons the customer marked as <strong>Requested</strong> from the quote viewer…
                </p>
              )}
              {!boxSelectionsLoading && boxSelectionsError && <p style={{ fontSize: 12, color: "#b91c1c" }}>{boxSelectionsError}</p>}
              {!boxSelectionsLoading && !boxSelectionsError && (!boxSelections || boxSelections.length === 0) && (
                <p style={{ fontSize: 12, color: "#6b7280" }}>
                  No cartons have been requested on this quote yet from the customer-facing /quote page.
                </p>
              )}
              {!boxSelectionsLoading && !boxSelectionsError && boxSelections && boxSelections.length > 0 && (
                <>
                  <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 6 }}>
                    These selections come from the public quote viewer when the customer clicks{" "}
                    <strong>&ldquo;Add this carton to my quote&rdquo;</strong>. Use this list as a heads-up when
                    finalizing packaging and placing box orders.
                  </p>
                  <ul style={{ listStyle: "disc", paddingLeft: 18, margin: 0, fontSize: 12, color: "#111827" }}>
                    {boxSelections.map((sel) => {
                      const metaParts: string[] = [];
                      if (sel.vendor) metaParts.push(sel.vendor);
                      if (sel.style) metaParts.push(sel.style);
                      if (sel.sku) metaParts.push(sel.sku);

                      return (
                        <li key={sel.id} style={{ marginBottom: 4 }}>
                          <div style={{ fontWeight: 500 }}>{sel.description || sel.sku}</div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>
                            {metaParts.join(" • ")} — Qty {sel.qty.toLocaleString()}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
                    Read-only mirror of{" "}
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>quote_box_selections</span>.
                    Changing cartons or quantities still happens via your normal quoting workflow.
                  </p>
                </>
              )}
            </div>

            {/* layout + CAD downloads */}
            <div style={{ marginTop: 4, marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Foam layout & CAD exports</div>

              <div style={{ ...cardBase, background: "#ffffff" }}>
                {!layoutPkg ? (
                  <p style={{ color: "#6b7280", fontSize: 13 }}>
                    No foam layout package has been stored for this quote yet. Have the client use the layout editor
                    from their emailed quote and click <strong>Apply to quote</strong>.
                  </p>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 8,
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: "#111827", marginBottom: 2 }}>Layout package #{layoutPkg.id}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>Saved: {new Date(layoutPkg.created_at).toLocaleString()}</div>
                        {notesPreview && (
                          <div
                            style={{
                              marginTop: 6,
                              color: "#4b5563",
                              fontSize: 12,
                              background: "#eef2ff",
                              borderRadius: 10,
                              padding: "6px 8px",
                              maxWidth: 420,
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>Notes: </span>
                            {notesPreview}
                          </div>
                        )}

                        {/* Admin-only: rebuild STEP */}
                        <div style={{ marginTop: 10 }}>
                          <div
                            style={{
                              fontSize: 11,
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                              color: "#6b7280",
                              marginBottom: 4,
                            }}
                          >
                            STEP maintenance
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <button
                              type="button"
                              onClick={handleRebuildStepNow}
                              disabled={rebuildBusy}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                border: "1px solid #111827",
                                background: rebuildBusy ? "#e5e7eb" : "#111827",
                                color: rebuildBusy ? "#6b7280" : "#ffffff",
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: rebuildBusy ? "not-allowed" : "pointer",
                              }}
                              title="Rebuilds and saves STEP into the latest quote_layout_packages.step_text via the STEP microservice"
                            >
                              {rebuildBusy ? "Rebuilding STEP..." : "Rebuild STEP now"}
                            </button>

                            {rebuildOkAt && <span style={{ fontSize: 11, color: "#065f46" }}>✅ Rebuilt: {rebuildOkAt}</span>}
                            {rebuildError && <span style={{ fontSize: 11, color: "#b91c1c" }}>❌ {rebuildError}</span>}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right", fontSize: 12, minWidth: 320 }}>
                        <div
                          style={{
                            marginBottom: 4,
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          Full Package
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            justifyContent: "flex-end",
                            alignItems: "center",
                          }}
                        >
                          {layoutPkg.svg_text && layoutPkg.svg_text.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={handleDownloadSvg}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                border: "1px solid #c7d2fe",
                                background: "#eef2ff",
                                color: "#1d4ed8",
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: "pointer",
                              }}
                            >
                              Download SVG
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={handleDownloadFullPackageDxf}
                            disabled={!layoutPkg.layout_json}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 999,
                              border: "1px solid #e5e7eb",
                              background: "#f9fafb",
                              color: "#111827",
                              fontSize: 11,
                              fontWeight: 500,
                              cursor: layoutPkg.layout_json ? "pointer" : "not-allowed",
                              opacity: layoutPkg.layout_json ? 1 : 0.6,
                            }}
                            title="Full Package DXF (on-demand). Uses the same correct scaling logic as the per-layer DXFs."
                          >
                            Download DXF
                          </button>

                          <button
                            type="button"
                            onClick={handleDownloadStep}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 999,
                              border: "1px solid #0ea5e9",
                              background: "#e0f2fe",
                              color: "#0369a1",
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                            title="Downloads Full Package STEP via /api/quote/layout/step (saved for this quote)."
                          >
                            Download STEP
                          </button>

                          <button
                            type="button"
                            onClick={handleDownloadAllLayersZip}
                            disabled={!layoutPkg.layout_json || zipBusy}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 999,
                              border: "1px solid #111827",
                              background: zipBusy ? "#e5e7eb" : "#111827",
                              color: zipBusy ? "#6b7280" : "#ffffff",
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: zipBusy ? "not-allowed" : "pointer",
                            }}
                            title="Downloads a ZIP containing per-layer DXF + STEP with manufacturer-friendly filenames."
                          >
                            {zipBusy ? "Building ZIP..." : "Download All Layers (ZIP)"}
                          </button>

                          {zipOkAt && <span style={{ fontSize: 11, color: "#065f46" }}>✅ ZIP: {zipOkAt}</span>}
                          {zipError && <span style={{ fontSize: 11, color: "#b91c1c" }}>❌ {zipError}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Per-layer previews + buttons */}
                    {layersForDxf && layersForDxf.length > 0 && layoutPkg.layout_json && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Layers (preview + downloads)</div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                            gap: 12,
                          }}
                        >
                          {layersForDxf.map((layer, idx) => {
                            const label = getLayerLabel(layer, idx);

                            // IMPORTANT (Path A): thickness might not be on the chosen preview array (stack vs layers).
                            // Resolve thickness from the full layout payload, with fallbacks.
                            const t = getLayerThicknessInFromLayout(layoutPkg.layout_json, idx);

                            const svg = buildSvgPreviewForLayer(layoutPkg.layout_json, idx);
                            const isSelected = idx === selectedLayerIdx;

                            const pocket = getLayerPocketDepthSummary(layoutPkg.layout_json, idx);

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
      boxShadow: isSelected
        ? "0 10px 22px rgba(14,165,233,0.20)"
        : "0 6px 16px rgba(15,23,42,0.06)",
      cursor: "pointer",
      outline: "none",
    }}
    title="Click to set the large preview to this layer"
  >
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{label}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
          {t ? `Thickness: ${t.toFixed(3)} in` : "Thickness: —"}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
          Pocket depth: {pocket.text}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>
        Layer {idx + 1}/{layersForDxf.length}
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

    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDownloadLayerDxf(idx, label, t);
        }}
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          border: "1px dashed #e5e7eb",
          background: "#f9fafb",
          color: "#111827",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Download DXF (layer)
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDownloadLayerStep(idx, label, t);
        }}
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          border: "1px solid #0ea5e9",
          background: "#e0f2fe",
          color: "#0369a1",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
        title="Generates a STEP for this single layer (including only this layer’s cavities) via /api/quote/layout/step-layer"
      >
        Download STEP (layer)
      </button>
    </div>

    <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
      Preview shows foam outline + cavity geometry (layer-specific).
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
                            const selLayer = layersForDxf[selectedLayerIdx] || null;
                            const selLabel = getLayerLabel(selLayer, selectedLayerIdx);

                            // Resolve thickness from full layout payload (NOT just the derived layer object)
                            const selT =
                              layoutPkg?.layout_json
                                ? getLayerThicknessInFromLayout(layoutPkg.layout_json, selectedLayerIdx)
                                : null;

                            const pocket = layoutPkg?.layout_json
                              ? getLayerPocketDepthSummary(layoutPkg.layout_json, selectedLayerIdx)
                              : { text: "—", hasMultiple: false };

                            return (
                              <div style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                                Selected layer preview:{" "}
                                <span style={{ fontWeight: 700 }}>
                                  {selLabel} (Layer {Math.min(selectedLayerIdx + 1, layersForDxf.length)}/
                                  {layersForDxf.length})
                                </span>
                                {" · "}
                                <span style={{ fontWeight: 600, color: "#111827" }}>
                                  Thickness: {selT ? `${selT.toFixed(3)} in` : "—"}
                                </span>
                                {" · "}
                                <span style={{ fontWeight: 600, color: "#111827" }}>
                                  Pocket depth: {pocket.text}
                                </span>
                              </div>
                            );
                          })()}

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
                              const svg = buildSvgPreviewForLayer(layoutPkg.layout_json, selectedLayerIdx);
                              if (!svg) return <div style={{ fontSize: 12, color: "#6b7280" }}>No preview</div>;
                              return (
                                <div
                                  style={{ width: "100%", height: "100%", display: "flex" }}
                                  dangerouslySetInnerHTML={{ __html: svg }}
                                />
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Full layout preview removed (layer previews are sufficient). */}
                  </>
                )}
              </div>

              {/* Layout activity */}
              {layoutPkg && (
                <div style={{ ...cardBase, background: "#ffffff", marginTop: 12 }}>
                  <div style={cardTitleStyle}>Layout activity</div>
                  <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 4 }}>
                    Latest layout package is <strong>#{layoutPkg.id}</strong>, saved on{" "}
                    {new Date(layoutPkg.created_at).toLocaleString()}.
                  </p>
                  <p style={{ fontSize: 11, color: "#9ca3af" }}>
                    Future upgrade: once a history API is wired, this panel will list multiple layout revisions with
                    timestamps.
                  </p>
                </div>
              )}
            </div>

            {/* optional: quick line items table (admin view) */}
            <div style={{ ...cardBase, background: "#ffffff" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>
                Line items (admin view)
              </div>
              {items.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>No line items stored for this quote.</p>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                    marginTop: 4,
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#eef2ff" }}>
                      <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>Line</th>
                      <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>Material</th>
                      <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>
                        Dims (L × W × H)
                      </th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e5e7eb" }}>Qty</th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e5e7eb" }}>Unit</th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e5e7eb" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const dims = item.length_in + " × " + item.width_in + " × " + item.height_in;
                      const label = item.material_name || "Material #" + item.material_id;
                      const unit = parsePriceField(item.price_unit_usd ?? null);
                      const total = parsePriceField(item.price_total_usd ?? null);
                      return (
                        <tr key={item.id}>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6" }}>{idx + 1}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6" }}>{label}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6" }}>{dims}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            {item.qty}
                          </td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            {formatUsd(unit)}
                          </td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            {formatUsd(total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <p style={{ marginTop: 24, fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
              Internal-only view. Use this page for engineering review and CAD exports. Clients should continue to use
              the public /quote link in their email.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

