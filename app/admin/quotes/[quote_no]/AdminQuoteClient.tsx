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
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";


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

  // NEW: /api/quote/print returns facts; we only use facts.revision here.
  facts?: any;
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

/* ============================================================
   🔒 NEW: canonical SVG rounded-rect path generator
   ============================================================ */

function svgRoundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) {
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }

  const x2 = x + w;
  const y2 = y + h;

  return [
    `M ${x + rr} ${y}`,
    `H ${x2 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x2} ${y + rr}`,
    `V ${y2 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x2 - rr} ${y2}`,
    `H ${x + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x} ${y2 - rr}`,
    `V ${y + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
    `Z`,
  ].join(" ");
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
  revision?: string | null;

}): string {
  const q = sanitizeFilenamePart(opts.quoteNo || "quote");
  const layerNum = opts.layerIndex + 1;
  const label = sanitizeFilenamePart(opts.layerLabel || "");
  const thick = formatThicknessForName(opts.thicknessIn);

  const parts: string[] = [];
  parts.push(q);
    const rev = sanitizeFilenamePart(opts.revision || "");
  if (rev) parts.push(rev);

  parts.push(`Layer-${layerNum}`);
  if (label) parts.push(label);
  if (thick) parts.push(thick);

  return `${parts.join("__")}.${opts.ext}`;
}

function buildFullPackageFilename(opts: {
  quoteNo: string;
  ext: "dxf" | "step" | "zip" | "svg";
  revision?: string | null;
}): string {
  const q = sanitizeFilenamePart(opts.quoteNo || "quote");
  const rev = sanitizeFilenamePart(opts.revision || "");
  const revPart = rev ? `__${rev}` : "";
  return `${q}__Full-Package${revPart}.${opts.ext}`;
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

  // Used only for admin per-layer preview clarity
  shape?: "rect" | "circle" | "roundedRect" | null;
  diameterIn?: number | null;

  // NEW: carry rounded corner radius through so admin previews can render it
  cornerRadiusIn?: number | null;
};

function arcEntity(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  return [
    "0",
    "ARC",
    "8",
    "0",
    "10",
    cx.toFixed(4),
    "20",
    cy.toFixed(4),
    "30",
    "0.0",
    "40",
    r.toFixed(4),
    "50",
    startDeg.toFixed(4),
    "51",
    endDeg.toFixed(4),
  ].join("\n");
}

function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
  return [
    "0",
    "LINE",
    "8",
    "0",
    "10",
    x1.toFixed(4),
    "20",
    y1.toFixed(4),
    "30",
    "0.0",
    "11",
    x2.toFixed(4),
    "21",
    y2.toFixed(4),
    "31",
    "0.0",
  ].join("\n");
}

function emitRoundedRectDXF(entities: string[], x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const x2 = x + w;
  const y2 = y + h;

  // Lines
  entities.push(lineEntity(x + rr, y, x2 - rr, y));
  entities.push(lineEntity(x2, y + rr, x2, y2 - rr));
  entities.push(lineEntity(x2 - rr, y2, x + rr, y2));
  entities.push(lineEntity(x, y2 - rr, x, y + rr));

  // Arcs (DXF angles are CCW, degrees)
  entities.push(arcEntity(x2 - rr, y + rr, rr, 270, 360)); // bottom-right
  entities.push(arcEntity(x2 - rr, y2 - rr, rr, 0, 90)); // top-right
  entities.push(arcEntity(x + rr, y2 - rr, rr, 90, 180)); // top-left
  entities.push(arcEntity(x + rr, y + rr, rr, 180, 270)); // bottom-left
}

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

function normalizeShape(raw: any): "rect" | "circle" | "roundedRect" | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;

  if (s === "circle" || s === "round" || s === "circular") return "circle";
  if (s === "roundedrect" || s === "rounded-rect" || s === "rounded_rectangle" || s === "rounded rectangle")
    return "roundedRect";
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

    // NEW: carry radius through (admin preview only; no logic elsewhere)
    const rawR =
      (cav as any).cornerRadiusIn ??
      (cav as any).corner_radius_in ??
      (cav as any).cornerRadius ??
      (cav as any).r ??
      null;
    const rNum = rawR == null ? NaN : Number(rawR);
    const cornerRadiusIn = Number.isFinite(rNum) && rNum > 0 ? rNum : null;

    out.push({
      lengthIn,
      widthIn: w,
      depthIn: Number.isFinite(depthIn || NaN) ? depthIn : null,
      x,
      y,
      shape: shape ?? null,
      diameterIn: diameterIn ?? null,
      cornerRadiusIn,
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

  let scale = 1;
  if (targetDimsIn && Number.isFinite(targetDimsIn.L) && targetDimsIn.L > 0 && Number.isFinite(rawL) && rawL > 0) {
    scale = targetDimsIn.L / rawL;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  }

  const L = rawL * scale;
  const W = fallbackW * scale;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntityLocal(x1: number, y1: number, x2: number, y2: number): string {
    return ["0", "LINE", "8", "0", "10", fmt(x1), "20", fmt(y1), "30", "0.0", "11", fmt(x2), "21", fmt(y2), "31", "0.0"].join(
      "\n",
    );
  }

  const entities: string[] = [];

 // Block outline: per-layer crop flag wins when a stack exists.
// Legacy single-layer falls back to block.cornerStyle / croppedCorners.
const stackArr: any[] | null = Array.isArray((layout as any)?.stack)
  ? ((layout as any).stack as any[])
  : Array.isArray((layout as any)?.layers)
    ? ((layout as any).layers as any[])
    : null;

const hasLayers = Array.isArray(stackArr) && stackArr.length > 0;
const layer = hasLayers ? stackArr![layerIndex] : null;

const layerCrop = !!(
  layer?.cropCorners ??
  layer?.croppedCorners ??
  layer?.cropped_corners ??
  layer?.cornerStyle === "chamfer"
);

const cornerStyleLegacy = String((layout as any)?.block?.cornerStyle ?? (layout as any)?.block?.corner_style ?? "").toLowerCase();
const croppedLegacy = !!((layout as any)?.block?.croppedCorners ?? (layout as any)?.block?.cropped_corners);

const wantsChamfer = hasLayers ? layerCrop : cornerStyleLegacy === "chamfer" || croppedLegacy;

const chamferInRaw = (layout as any)?.block?.chamferIn ?? (layout as any)?.block?.chamfer_in;
const chamferInNum = chamferInRaw == null ? NaN : Number(chamferInRaw);
const chamferIn = Number.isFinite(chamferInNum) && chamferInNum > 0 ? chamferInNum : 1;

// chamfer is in inches, so scale it to match our scaled L/W
const chamferScaled =
  wantsChamfer
    ? Math.max(0, Math.min(chamferIn * scale, L / 2 - 1e-6, W / 2 - 1e-6))
    : 0;


  if (chamferScaled > 0.0001) {
    const c = chamferScaled;

        // Two-corner chamfer: TOP-LEFT + BOTTOM-RIGHT only.
    // Coordinate system here: (0,0)=bottom-left, (L,W)=top-right.
    //
    // Top-left chamfer cuts corner near (0,W)
    // Bottom-right chamfer cuts corner near (L,0)

    // Bottom edge: start at bottom-left (square), end before bottom-right chamfer
    entities.push(lineEntityLocal(0, 0, L - c, 0));

    // Bottom-right chamfer edge
    entities.push(lineEntityLocal(L - c, 0, L, c));

    // Right edge (square at top-right)
    entities.push(lineEntityLocal(L, c, L, W));

    // Top edge: go to just right of top-left chamfer
    entities.push(lineEntityLocal(L, W, c, W));

    // Top-left chamfer edge
    entities.push(lineEntityLocal(c, W, 0, W - c));

    // Left edge down to bottom-left (square)
    entities.push(lineEntityLocal(0, W - c, 0, 0));

  } else {
    // default square block
    entities.push(lineEntityLocal(0, 0, L, 0));
    entities.push(lineEntityLocal(L, 0, L, W));
    entities.push(lineEntityLocal(L, W, 0, W));
    entities.push(lineEntityLocal(0, W, 0, 0));
  }


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
      const dia = cav.diameterIn && cav.diameterIn > 0 ? cav.diameterIn : Math.min(cL, cW);
      const r = dia / 2;
      const cx = left + cL / 2;
      const cy = bottom + cW / 2;

      entities.push(["0", "CIRCLE", "8", "0", "10", fmt(cx), "20", fmt(cy), "30", "0.0", "40", fmt(r)].join("\n"));
      continue;
    }

    if ((cav.shape === "roundedRect" || cav.cornerRadiusIn) && cav.cornerRadiusIn) {
      emitRoundedRectDXF(entities, left, bottom, cL, cW, cav.cornerRadiusIn);
      continue;
    }

    entities.push(lineEntityLocal(left, bottom, left + cL, bottom));
    entities.push(lineEntityLocal(left + cL, bottom, left + cL, bottom + cW));
    entities.push(lineEntityLocal(left + cL, bottom + cW, left, bottom + cW));
    entities.push(lineEntityLocal(left, bottom + cW, left, bottom));
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
    "1",
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

function buildDxfForFullPackage(layout: any, targetDimsIn?: TargetDimsIn): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  const rawL = Number(block.lengthIn ?? block.length_in);
  const rawW = Number(block.widthIn ?? block.width_in);

  if (!Number.isFinite(rawL) || rawL <= 0) return null;
  const fallbackW = Number.isFinite(rawW) && rawW > 0 ? rawW : rawL;

  let scale = 1;
  if (targetDimsIn?.L && rawL > 0) scale = targetDimsIn.L / rawL;

  const L = rawL * scale;
  const W = fallbackW * scale;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntityLocal(x1: number, y1: number, x2: number, y2: number): string {
    return ["0", "LINE", "8", "0", "10", fmt(x1), "20", fmt(y1), "30", "0.0", "11", fmt(x2), "21", fmt(y2), "31", "0.0"].join(
      "\n",
    );
  }

  const entities: string[] = [];

  entities.push(lineEntityLocal(0, 0, L, 0));
  entities.push(lineEntityLocal(L, 0, L, W));
  entities.push(lineEntityLocal(L, W, 0, W));
  entities.push(lineEntityLocal(0, W, 0, 0));

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
        const dia = cav.diameterIn ?? Math.min(cL, cW);
        const r = dia / 2;
        const cx = left + cL / 2;
        const cy = bottom + cW / 2;

        entities.push(["0", "CIRCLE", "8", "0", "10", fmt(cx), "20", fmt(cy), "30", "0.0", "40", fmt(r)].join("\n"));
        continue;
      }

      if ((cav.shape === "roundedRect" || cav.cornerRadiusIn) && cav.cornerRadiusIn) {
        emitRoundedRectDXF(entities, left, bottom, cL, cW, cav.cornerRadiusIn);
        continue;
      }

      entities.push(lineEntityLocal(left, bottom, left + cL, bottom));
      entities.push(lineEntityLocal(left + cL, bottom, left + cL, bottom + cW));
      entities.push(lineEntityLocal(left + cL, bottom + cW, left, bottom + cW));
      entities.push(lineEntityLocal(left, bottom + cW, left, bottom));
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
    "1",
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
  if (!layout?.block) return null;

  let L = Number(layout.block.lengthIn ?? layout.block.length_in);
  let W = Number(layout.block.widthIn ?? layout.block.width_in);
  if (!Number.isFinite(L) || L <= 0) return null;
  if (!Number.isFinite(W) || W <= 0) W = L;

  const cavs = getCavitiesForLayer(layout, layerIndex);

  const stroke = "#111827";
  const cavStroke = "#ef4444";
  const strokeWidth = Math.max(0.04, Math.min(L, W) / 250);
  const cavStrokeWidth = Math.max(0.03, Math.min(L, W) / 300);

  // Block outline:
  // - If the layout is multi-layer, use this layer's own crop flag.
  // - If legacy single-layer, fall back to block-level cornerStyle/croppedCorners.
  const stackArr: any[] | null = Array.isArray(layout?.stack) ? layout.stack : Array.isArray(layout?.layers) ? layout.layers : null;
  const hasLayers = Array.isArray(stackArr) && stackArr.length > 0;
  const layer = hasLayers ? stackArr![layerIndex] : null;
  const layerCrop = !!(
    layer?.cropCorners ??
    layer?.croppedCorners ??
    layer?.cropped_corners ??
    layer?.cornerStyle === "chamfer"
  );
  const cornerStyleLegacy = String(layout?.block?.cornerStyle ?? layout?.block?.corner_style ?? "").toLowerCase();
  const croppedLegacy = !!(layout?.block?.croppedCorners ?? layout?.block?.cropped_corners);
  const wantsChamfer = hasLayers ? layerCrop : cornerStyleLegacy === "chamfer" || croppedLegacy;

  const chamferInRaw = layout?.block?.chamferIn ?? layout?.block?.chamfer_in;
  const chamferInNum = chamferInRaw == null ? NaN : Number(chamferInRaw);
  const chamferIn = Number.isFinite(chamferInNum) && chamferInNum > 0 ? chamferInNum : 1;

  const chamfer =
    wantsChamfer && Number.isFinite(chamferIn) && chamferIn > 0
      ? Math.max(0, Math.min(chamferIn, L / 2 - 1e-6, W / 2 - 1e-6))
      : 0;

const blockOutline =
  chamfer > 0.0001
    ? (() => {
        // Diagonal chamfer only: TOP-LEFT + BOTTOM-RIGHT
        const c = chamfer;

        const d = [
          // Start after TL chamfer on top edge
          `M ${c} 0`,
          `L ${L} 0`,          // top-right square
          `L ${L} ${W - c}`,   // approach BR chamfer
          `L ${L - c} ${W}`,   // bottom-right chamfer
          `L 0 ${W}`,          // bottom-left square
          `L 0 ${c}`,          // up left edge
          `L ${c} 0`,          // top-left chamfer
          `Z`,
        ].join(" ");

        return `<path d="${d}" fill="#fff" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
      })()
    : `<rect x="0" y="0" width="${L}" height="${W}" fill="#fff" stroke="${stroke}" stroke-width="${strokeWidth}" />`;



  const shapes = cavs.map((c) => {
    const x = L * c.x;
    const y = W * c.y;
    const w = c.lengthIn;
    const h = c.widthIn;

    const r =
      c.cornerRadiusIn && Number.isFinite(c.cornerRadiusIn) ? Math.max(0, Math.min(c.cornerRadiusIn, w / 2, h / 2)) : 0;

    if (c.shape === "circle") {
      const d = c.diameterIn ?? Math.min(w, h);
      const rr = d / 2;
      return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${rr}"
        fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
    }

    if (c.shape === "roundedRect" || r > 0) {
      const d = svgRoundedRectPath(x, y, w, h, r);
      return `<path d="${d}"
        fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
    }

    return `<rect x="${x}" y="${y}" width="${w}" height="${h}"
      fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${W}" width="100%" height="100%">`,
    blockOutline,
    shapes.join(""),
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
    // NEW: Send-to-customer (Graph) state
  const [sendBusy, setSendBusy] = React.useState<boolean>(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [sendOkAt, setSendOkAt] = React.useState<string | null>(null);


  const [selectedLayerIdx, setSelectedLayerIdx] = React.useState<number>(0);

  /* ============================================================
     NEW: Revision editor (facts-backed via /api/admin/mem)
     ============================================================ */

  const [revisionValue, setRevisionValue] = React.useState<string>("RevAS");
  const [revisionBusy, setRevisionBusy] = React.useState<boolean>(false);
  const [revisionError, setRevisionError] = React.useState<string | null>(null);
  const [revisionOkAt, setRevisionOkAt] = React.useState<string | null>(null);

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

      // Keep revision UI stable across refresh; reset only errors/saved markers.
      setRevisionError(null);
      setRevisionOkAt(null);

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

            // NEW: Pull revision from facts if present; default RevAS.
            const revRaw = (json as any)?.facts?.revision;
            const rev = typeof revRaw === "string" && revRaw.trim().length > 0 ? revRaw.trim() : "RevAS";
            setRevisionValue(rev);
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
            const msg = (!json.ok && (json as BoxesForQuoteErr).error) || "Unable to load requested cartons for this quote.";
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

  const primaryMaterialName = primaryItem?.material_name || (primaryItem ? `Material #${primaryItem.material_id}` : null);
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

  const layersForDxf = React.useMemo(() => (layoutPkg && layoutPkg.layout_json ? getLayersFromLayout(layoutPkg.layout_json) : []), [
    layoutPkg,
  ]);

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
      Number.isFinite(targetL) && targetL > 0 && Number.isFinite(targetW) && targetW > 0 ? ({ L: targetL, W: targetW } as TargetDimsIn) : undefined;
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
      const filename = buildFullPackageFilename({ quoteNo: baseName, ext: "svg", revision: revisionValue });
      triggerBlobDownload(blob, filename);

    } catch (err) {
      console.error("Admin: SVG download failed:", err);
    }
    }, [layoutPkg, quoteState, revisionValue]);


  const handleDownloadFullPackageDxf = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (!layoutPkg) return;

    // IMPORTANT:
    // Use the same server-regenerated export strings returned by /api/quote/print
    // (layoutPkg.dxf_text), so Admin downloads match the interactive quote pipeline.
    // Fallback to legacy client-side DXF builder only if dxf_text is missing.
    const targetDims = getTargetDims();
    const dxf =
      (typeof layoutPkg.dxf_text === "string" && layoutPkg.dxf_text.trim().length > 0
        ? layoutPkg.dxf_text
        : layoutPkg.layout_json
          ? buildDxfForFullPackage(layoutPkg.layout_json, targetDims)
          : null);

    if (!dxf) return;

    try {
      const blob = new Blob([dxf], { type: "application/dxf" });
            const baseName = quoteState?.quote_no || "quote";
      const filename = buildFullPackageFilename({ quoteNo: baseName, ext: "dxf", revision: revisionValue });
      triggerBlobDownload(blob, filename);

    } catch (err) {
      console.error("Admin: full package DXF download failed:", err);
    }
    }, [layoutPkg, quoteState, primaryItem, revisionValue]);


   const handleDownloadStep = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!layoutPkg) return;

    // Prefer server-regenerated STEP returned by /api/quote/print,
    // but fall back to /api/quote/layout/step if step_text is missing/bad.
    const stepText = typeof layoutPkg.step_text === "string" ? layoutPkg.step_text.trim() : "";

    try {
      const baseName = quoteState?.quote_no || quoteNoValue || "quote";
      const filename = buildFullPackageFilename({ quoteNo: baseName, ext: "step", revision: revisionValue });

      if (stepText.length > 200) {
        // Looks like real STEP content
        const blob = new Blob([layoutPkg.step_text as string], { type: "application/octet-stream" });
        triggerBlobDownload(blob, filename);
        return;
      }

      // Fallback: fetch the STEP via route (may be DB-stored but better than blank)
      const url = `/api/quote/layout/step?quote_no=${encodeURIComponent(quoteNoValue)}&t=${encodeURIComponent(String(Date.now()))}`;
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        console.error("Admin: fallback STEP fetch failed:", res.status, res.statusText);
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "application/octet-stream" });
      triggerBlobDownload(blob, filename);
    } catch (err) {
      console.error("Admin: STEP download failed:", err);
    }
  }, [layoutPkg, quoteNoValue, quoteState, revisionValue]);



  const handleDownloadLayerStep = React.useCallback(
    async (layerIndex: number, layerLabel: string | null, thicknessIn: number | null) => {
      if (typeof window === "undefined") return;
      if (!quoteNoValue) return;

      const url = `/api/quote/layout/step-layer?quote_no=${encodeURIComponent(quoteNoValue)}&layer_index=${encodeURIComponent(String(layerIndex))}`;

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
          revision: revisionValue,
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
        [quoteNoValue, quoteState, revisionValue],

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
          revision: revisionValue,
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
        [layoutPkg, quoteState, primaryItem, quoteNoValue, revisionValue],

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
            revision: revisionValue,
            layerIndex: i,
            layerLabel: label,
            thicknessIn,
            ext: "dxf",
          });
          root.file(dxfName, dxf);
        }

        // STEP (server-generated via microservice route)
        const stepUrl = `/api/quote/layout/step-layer?quote_no=${encodeURIComponent(quoteNoValue)}&layer_index=${encodeURIComponent(String(i))}`;

        try {
          const res = await fetch(stepUrl, { cache: "no-store" });
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const stepName = buildLayerFilename({
              quoteNo: baseName,
              revision: revisionValue,
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
            const zipName = buildFullPackageFilename({ quoteNo: baseName, ext: "zip", revision: revisionValue });


      triggerBlobDownload(zipBlob, zipName);

      setZipOkAt(new Date().toLocaleString());
    } catch (e: any) {
      console.error("Admin: zip build failed:", e);
      setZipError(String(e?.message ?? e));
    } finally {
      setZipBusy(false);
    }
    }, [layoutPkg, quoteNoValue, quoteState, zipBusy, primaryItem, revisionValue]);


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

  // NEW: Save revision to facts store via /api/admin/mem
  const handleSaveRevision = React.useCallback(async () => {
    if (!quoteNoValue) return;
    if (revisionBusy) return;

    const rev = (revisionValue || "").trim();
    if (!rev) {
      setRevisionError("Revision cannot be blank.");
      return;
    }

    setRevisionBusy(true);
    setRevisionError(null);
    setRevisionOkAt(null);

    try {
      const res = await fetch("/api/admin/mem?t=" + String(Date.now()), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ key: quoteNoValue, revision: rev }),
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
        setRevisionError(json?.error || json?.message || "Save failed.");
        return;
      }

      setRevisionOkAt(new Date().toLocaleString());
      // Keep UI in sync; also refresh print data so it shows up in facts if needed later.
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      console.error("Admin: revision save failed:", e);
      setRevisionError(String(e?.message ?? e));
    } finally {
      setRevisionBusy(false);
    }
  }, [quoteNoValue, revisionBusy, revisionValue]);

    // NEW: Admin-only send to customer (Graph -> /api/ms/send)
  const handleSendToCustomer = React.useCallback(async () => {
    if (!quoteNoValue) return;
    if (sendBusy) return;

    const to = (quoteState?.email || "").trim();
    if (!to) {
      setSendError("No customer email on this quote.");
      return;
    }

    if (!primaryItem) {
      setSendError("No primary line item found for this quote.");
      return;
    }

    // Build a clean subject line (include revision)
    const rev = (revisionValue || "").trim();
    const subj = `Quote ${quoteNoValue}${rev ? " " + rev : ""}`;

    setSendBusy(true);
    setSendError(null);
    setSendOkAt(null);

    try {
      // 1) Get authoritative pricing snapshot from /api/quotes/calc (same shape used by orchestrate)
      const L = Number(primaryItem.length_in);
      const W = Number(primaryItem.width_in);
      const H = Number(primaryItem.height_in);
      const qty = Number(primaryItem.qty);
      const material_id = Number(primaryItem.material_id);

      let calcResult: any = null;

      if (Number.isFinite(L) && Number.isFinite(W) && Number.isFinite(H) && Number.isFinite(qty) && Number.isFinite(material_id)) {
        const r = await fetch(`/api/quotes/calc?t=${Date.now()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            length_in: L,
            width_in: W,
            height_in: H,
            material_id,
            qty,
            cavities: [],
            round_to_bf: false,
          }),
        });

        const j = await r.json().catch(() => ({} as any));
        if (r.ok && j?.ok && j?.result) {
          calcResult = j.result;
        }
      }

      // 2) Build email HTML (template expects TemplateInput)
      const density = primaryItem.density_lb_ft3 != null ? Number(primaryItem.density_lb_ft3) : null;
      const density_pcf = density != null && Number.isFinite(density) ? density : null;

      const totalFromStored = (() => {
        // fallback to stored subtotal for safety
        const n = Number(subtotal);
        return Number.isFinite(n) ? n : 0;
      })();

      const total =
        calcResult && typeof calcResult.total === "number" && Number.isFinite(calcResult.total) ? calcResult.total : totalFromStored;

      const used_min_charge =
        calcResult && typeof calcResult.used_min_charge === "boolean" ? calcResult.used_min_charge : null;

      const html = renderQuoteEmail({
        customerLine: `${quoteState?.customer_name || "Customer"}${quoteState?.email ? " • " + quoteState.email : ""}`,
        quoteNumber: quoteNoValue,
        status: quoteState?.status || "Draft",
        specs: {
          L_in: Number(primaryItem.length_in),
          W_in: Number(primaryItem.width_in),
          H_in: Number(primaryItem.height_in),
          qty: primaryItem.qty ?? null,
          density_pcf,
          foam_family: primaryItem.material_family ?? null,
          thickness_under_in: null,
          color: null,
          cavityCount: null,
          cavityDims: [],
        },
        material: {
          name: primaryItem.material_name || `Material #${primaryItem.material_id}`,
          density_lbft3: density_pcf,
          kerf_pct: calcResult?.kerf_pct ?? primaryItem?.pricing_meta?.kerf_pct ?? null,
          min_charge: calcResult?.min_charge ?? primaryItem?.pricing_meta?.min_charge ?? null,
        },
        pricing: {
          total,
          piece_ci: calcResult?.piece_ci ?? null,
          order_ci: calcResult?.order_ci ?? null,
          order_ci_with_waste: calcResult?.order_ci_with_waste ?? null,
          used_min_charge,
          raw: calcResult ?? null,
          price_breaks: null,
        },
        missing: [],
        facts: {
          revision: rev || null,
        },
      });

      // 3) Send via Graph wrapper route (already flips quotes.status='sent' server-side when quoteNo is provided)
      const res = await fetch(`/api/ms/send?t=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          to,
          subject: subj,
          html,
          quoteNo: quoteNoValue,
        }),
      });

      const ct = res.headers.get("content-type") || "";
      const j = ct.includes("application/json") ? await res.json().catch(() => ({} as any)) : await res.text();

      if (!res.ok || !j || (typeof j === "object" && j.ok === false)) {
        const msg =
          typeof j === "string"
            ? j
            : j?.message || j?.error || `Send failed (HTTP ${res.status})`;
        setSendError(msg);
        return;
      }

      setSendOkAt(new Date().toLocaleString());

      // Refresh quote status pill
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      console.error("Admin: send-to-customer failed:", e);
      setSendError(String(e?.message ?? e));
    } finally {
      setSendBusy(false);
    }
  }, [quoteNoValue, sendBusy, quoteState, primaryItem, subtotal, revisionValue]);


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
                        <a
              href="/admin/quotes"
              style={{
                display: "inline-block",
                fontSize: 11,
                color: "rgba(255,255,255,0.92)",
                textDecoration: "none",
                marginBottom: 6,
              }}
            >
              ← Back to quotes list
            </a>

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
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 8,
              minWidth: 320,
            }}
          >
            {quoteState && (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
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

                                    {/* NEW: Admin-only send */}
                  <button
                    type="button"
                    onClick={handleSendToCustomer}
                    disabled={sendBusy || !quoteState?.email}
                    style={{
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 999,
  background: sendBusy
    ? "rgba(15,23,42,0.12)"
    : "rgba(15,23,42,0.2)",
  border: "1px solid rgba(15,23,42,0.25)",
  color: "#f9fafb",
  fontSize: 11,
  fontWeight: 600,
  cursor: sendBusy || !quoteState?.email ? "not-allowed" : "pointer",
  opacity: sendBusy || !quoteState?.email ? 0.7 : 1,
}}

                    title={quoteState?.email ? "Send quote email to customer (Graph; saves to Sent Items)" : "No customer email on this quote"}
                  >
                    {sendBusy ? "Sending..." : "Send to customer"}
                  </button>


                  {/* NEW: Revision editor */}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "rgba(15,23,42,0.18)",
                      border: "1px solid rgba(15,23,42,0.20)",
                      color: "#f9fafb",
                    }}
                    title="Internal revision label stored in facts (e.g., RevAS / RevBS … RevA / RevB …)"
                  >
                    <span style={{ fontSize: 11, opacity: 0.95, fontWeight: 700 }}>REV</span>
                    <input
                      value={revisionValue}
                      onChange={(e) => setRevisionValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveRevision();
                        }
                      }}
                      style={{
                        width: 90,
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(255,255,255,0.10)",
                        color: "#ffffff",
                        borderRadius: 8,
                        padding: "2px 6px",
                        fontSize: 11,
                        outline: "none",
                      }}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={handleSaveRevision}
                      disabled={revisionBusy}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.40)",
                        background: revisionBusy ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.12)",
                        color: "#ffffff",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: revisionBusy ? "not-allowed" : "pointer",
                      }}
                      title="Save revision to facts store"
                    >
                      {revisionBusy ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      opacity: 0.9,
                    }}
                  >
                    Created: {new Date(quoteState.created_at).toLocaleString()}
                  </p>

                  {revisionOkAt && <span style={{ fontSize: 11, color: "#dcfce7", fontWeight: 700 }}>✅ Saved</span>}
                  {revisionError && <span style={{ fontSize: 11, color: "#fee2e2", fontWeight: 700 }}>❌ {revisionError}</span>}
                                    {sendOkAt && <span style={{ fontSize: 11, color: "#dcfce7", fontWeight: 700 }}>✅ Sent</span>}
                  {sendError && <span style={{ fontSize: 11, color: "#fee2e2", fontWeight: 700 }}>❌ {sendError}</span>}

                </div>
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
                                ? ` Pricing is currently governed by the minimum charge (${formatUsd(minChargeValue ?? subtotal)}), not the raw volume math.`
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
                      <div>{primaryMaterialFamily || <span style={{ color: "#9ca3af" }}>Unassigned (set in materials admin)</span>}</div>
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
                        <a href={`/admin/cushion-curves/${primaryItem.material_id}`} style={{ color: "#0369a1", textDecoration: "none" }}>
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
                <p style={{ fontSize: 12, color: "#6b7280" }}>No cartons have been requested on this quote yet from the customer-facing /quote page.</p>
              )}
              {!boxSelectionsLoading && !boxSelectionsError && boxSelections && boxSelections.length > 0 && (
                <>
                  <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 6 }}>
                    These selections come from the public quote viewer when the customer clicks{" "}
                    <strong>&ldquo;Add this carton to my quote&rdquo;</strong>. Use this list as a heads-up when finalizing packaging and placing box
                    orders.
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
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>quote_box_selections</span>. Changing cartons or quantities
                    still happens via your normal quoting workflow.
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
                    No foam layout package has been stored for this quote yet. Have the client use the layout editor from their emailed quote and click{" "}
                    <strong>Apply to quote</strong>.
                  </p>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
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
                          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280", marginBottom: 4 }}>
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
                        <div style={{ marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280" }}>Full Package</div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
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

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
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
                                  boxShadow: isSelected ? "0 10px 22px rgba(14,165,233,0.20)" : "0 6px 16px rgba(15,23,42,0.06)",
                                  cursor: "pointer",
                                  outline: "none",
                                }}
                                title="Click to set the large preview to this layer"
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{label}</div>
                                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{t ? `Thickness: ${t.toFixed(3)} in` : "Thickness: —"}</div>
                                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Pocket depth: {pocket.text}</div>
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
                                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#6b7280" }}>
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

                                <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>Preview shows foam outline + cavity geometry (layer-specific).</div>
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
                            const selT = layoutPkg?.layout_json ? getLayerThicknessInFromLayout(layoutPkg.layout_json, selectedLayerIdx) : null;

                            const pocket = layoutPkg?.layout_json ? getLayerPocketDepthSummary(layoutPkg.layout_json, selectedLayerIdx) : { text: "—", hasMultiple: false };

                            return (
                              <div style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                                Selected layer preview:{" "}
                                <span style={{ fontWeight: 700 }}>
                                  {selLabel} (Layer {Math.min(selectedLayerIdx + 1, layersForDxf.length)}/{layersForDxf.length})
                                </span>
                                {" · "}
                                <span style={{ fontWeight: 600, color: "#111827" }}>Thickness: {selT ? `${selT.toFixed(3)} in` : "—"}</span>
                                {" · "}
                                <span style={{ fontWeight: 600, color: "#111827" }}>Pocket depth: {pocket.text}</span>
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
                              return <div style={{ width: "100%", height: "100%", display: "flex" }} dangerouslySetInnerHTML={{ __html: svg }} />;
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
                    Latest layout package is <strong>#{layoutPkg.id}</strong>, saved on {new Date(layoutPkg.created_at).toLocaleString()}.
                  </p>
                  <p style={{ fontSize: 11, color: "#9ca3af" }}>
                    Future upgrade: once a history API is wired, this panel will list multiple layout revisions with timestamps.
                  </p>
                </div>
              )}
            </div>

            {/* optional: quick line items table (admin view) */}
            <div style={{ ...cardBase, background: "#ffffff" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>Line items (admin view)</div>
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
                      <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>Dims (L × W × H)</th>
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
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>{item.qty}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>{formatUsd(unit)}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>{formatUsd(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <p style={{ marginTop: 24, fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
              Internal-only view. Use this page for engineering review and CAD exports. Clients should continue to use the public /quote link in their email.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
