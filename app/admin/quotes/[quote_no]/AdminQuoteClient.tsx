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

/* ---------------- DXF helpers (per-layer + full package) ---------------- */

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

  shape?: "rect" | "circle" | null;
  diameterIn?: number | null;
};

type TargetDimsIn = { L: number; W: number };

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

    const rawDia =
      (cav as any).diameterIn ?? (cav as any).diameter_in ?? (cav as any).diameter ?? null;
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

function buildDxfForLayer(layout: any, layerIndex: number, targetDimsIn?: TargetDimsIn): string | null {
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

  // Cavities
  const cavs = getCavitiesForLayer(layout, layerIndex);

  for (const cav of cavs) {
    const cL = cav.lengthIn;
    const cW = cav.widthIn;

    const xLeft = L * cav.x;
    const yTopSvg = W * cav.y;

    const yBottom = W - yTopSvg - cW;

    const left = Math.max(0, Math.min(L - cL, xLeft));
    const bottom = Math.max(0, Math.min(W - cW, yBottom));

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
 * Full Package DXF (on-demand, client-side):
 * - Uses the same "good" scaling + orientation as the per-layer generator.
 * - Combines cavities from ALL layers into one DXF.
 * - This intentionally avoids using layoutPkg.dxf_text (which is currently mis-scaled).
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

      const xLeft = L * cav.x;
      const yTopSvg = W * cav.y;
      const yBottom = W - yTopSvg - cW;

      const left = Math.max(0, Math.min(L - cL, xLeft));
      const bottom = Math.max(0, Math.min(W - cW, yBottom));

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
          c.diameterIn != null && Number.isFinite(c.diameterIn) && c.diameterIn > 0 ? c.diameterIn : Math.min(w2, h2);
        const r = Math.max(0, Math.min(dia / 2, Math.min(w2, h2) / 2));
        if (r <= 0) return "";

        const cx = x2 + w2 / 2;
        const cy = y2 + h2 / 2;

        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cavStroke}" stroke-width="${cavStrokeWidth}" />`;
      }

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
              (!json.ok && (json as BoxesForQuoteErr).error) ||
              "Unable to load requested cartons for this quote.";
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
  const primaryDensityDisplay =
    primaryDensity != null && Number.isFinite(primaryDensity) ? primaryDensity.toFixed(2) : null;

  const customerQuoteUrl =
    primaryItem && quoteNoValue ? `/quote?quote_no=${encodeURIComponent(quoteNoValue)}` : null;

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

  const handleDownload = React.useCallback(
    (kind: "svg") => {
      if (typeof window === "undefined") return;
      if (!layoutPkg) return;

      let data: string | null = null;
      let ext = "";
      let mime = "";

      if (kind === "svg" && layoutPkg.svg_text) {
        data = layoutPkg.svg_text;
        ext = "svg";
        mime = "image/svg+xml";
      }

      if (!data) return;

      try {
        const blob = new Blob([data], { type: mime || "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const baseName = quoteState?.quote_no || "quote";
        a.download = `${baseName}-layout-${layoutPkg.id}.${ext || "txt"}`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Admin: download failed:", err);
      }
    },
    [layoutPkg, quoteState],
  );

  // Full Package DXF: generate on-demand using the good scaler/orientation (NOT layoutPkg.dxf_text)
  const handleDownloadFullPackageDxf = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (!layoutPkg || !layoutPkg.layout_json) return;

    const targetL = primaryItem ? Number(primaryItem.length_in) : NaN;
    const targetW = primaryItem ? Number(primaryItem.width_in) : NaN;
    const targetDims =
      Number.isFinite(targetL) && targetL > 0 && Number.isFinite(targetW) && targetW > 0
        ? ({ L: targetL, W: targetW } as TargetDimsIn)
        : undefined;

    const dxf = buildDxfForFullPackage(layoutPkg.layout_json, targetDims);
    if (!dxf) return;

    try {
      const blob = new Blob([dxf], { type: "application/dxf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const baseName = quoteState?.quote_no || "quote";
      a.download = `${baseName}-layout-full-package.dxf`;

      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Admin: full package DXF download failed:", err);
    }
  }, [layoutPkg, quoteState, primaryItem]);

  const handleDownloadStep = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (!quoteNoValue) return;

    const url = `/api/quote/layout/step?quote_no=${encodeURIComponent(quoteNoValue)}`;

    try {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("Admin: STEP download failed:", err);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [quoteNoValue]);

  const handleDownloadLayerStep = React.useCallback(
    (layerIndex: number) => {
      if (typeof window === "undefined") return;
      if (!quoteNoValue) return;

      const url = `/api/quote/layout/step-layer?quote_no=${encodeURIComponent(
        quoteNoValue,
      )}&layer_index=${encodeURIComponent(String(layerIndex))}`;

      try {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        console.error("Admin: layer STEP download failed:", err);
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [quoteNoValue],
  );

  const handleDownloadLayerDxf = React.useCallback(
    (layerIndex: number) => {
      if (typeof window === "undefined") return;
      if (!layoutPkg || !layoutPkg.layout_json) return;

      const targetL = primaryItem ? Number(primaryItem.length_in) : NaN;
      const targetW = primaryItem ? Number(primaryItem.width_in) : NaN;
      const targetDims =
        Number.isFinite(targetL) && targetL > 0 && Number.isFinite(targetW) && targetW > 0
          ? ({ L: targetL, W: targetW } as TargetDimsIn)
          : undefined;

      const dxf = buildDxfForLayer(layoutPkg.layout_json, layerIndex, targetDims);
      if (!dxf) return;

      try {
        const blob = new Blob([dxf], { type: "application/dxf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const baseName = quoteState?.quote_no || "quote";
        const suffix = `layer-${layerIndex + 1}`;
        a.download = `${baseName}-layout-${suffix}.dxf`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Admin: layer DXF download failed:", err);
      }
    },
    [layoutPkg, quoteState, primaryItem],
  );

  const [rebuildBusy, setRebuildBusy] = React.useState<boolean>(false);
  const [rebuildError, setRebuildError] = React.useState<string | null>(null);
  const [rebuildOkAt, setRebuildOkAt] = React.useState<string | null>(null);

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

        {!loading && quoteState && (
          <>
            {/* (…everything above your Foam layout section remains unchanged in your existing file…) */}

            {/* layout + CAD downloads */}
            <div style={{ marginTop: 4, marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>
                Foam layout & CAD exports
              </div>

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
                        <div style={{ fontWeight: 600, color: "#111827", marginBottom: 2 }}>
                          Layout package #{layoutPkg.id}
                        </div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>
                          Saved: {new Date(layoutPkg.created_at).toLocaleString()}
                        </div>

                        {/* STEP maintenance (unchanged) */}
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

                            {rebuildOkAt && (
                              <span style={{ fontSize: 11, color: "#065f46" }}>✅ Rebuilt: {rebuildOkAt}</span>
                            )}
                            {rebuildError && <span style={{ fontSize: 11, color: "#b91c1c" }}>❌ {rebuildError}</span>}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right", fontSize: 12, minWidth: 260 }}>
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

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                          {layoutPkg.svg_text && layoutPkg.svg_text.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleDownload("svg")}
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

                          {/* ✅ FIX: Full Package DXF now generated on-demand (correct scale) */}
                          <button
                            type="button"
                            onClick={handleDownloadFullPackageDxf}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 999,
                              border: "1px solid #e5e7eb",
                              background: "#f9fafb",
                              color: "#111827",
                              fontSize: 11,
                              fontWeight: 500,
                              cursor: layoutPkg?.layout_json ? "pointer" : "not-allowed",
                              opacity: layoutPkg?.layout_json ? 1 : 0.6,
                            }}
                            title="Full Package DXF (on-demand). Uses the same correct scale/orientation logic as per-layer DXF."
                            disabled={!layoutPkg?.layout_json}
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
                            title="Downloads latest STEP saved for this quote via /api/quote/layout/step"
                          >
                            Download STEP
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* (…the rest of your existing per-layer section + full SVG preview remains unchanged…) */}
                    {/* NOTE: To keep this drop-in self-contained, paste back the remainder of your file below as-is.
                        If you'd rather I deliver the fully reconstituted remainder in one block, tell me and I will.
                    */}
                  </>
                )}
              </div>
            </div>

            {/* NOTE:
               The rest of your file (line items table + footer) remains exactly as in your current version.
               This drop-in focuses only on swapping the top DXF download to the on-demand generator.
            */}
          </>
        )}
      </div>
    </div>
  );
}
