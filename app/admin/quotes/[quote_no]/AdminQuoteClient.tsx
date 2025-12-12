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
};

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

    out.push({
      lengthIn,
      widthIn: w,
      depthIn: Number.isFinite(depthIn || NaN) ? depthIn : null,
      x,
      y,
    });
  }

  return out;
}

/**
 * Build a DXF for a single layer:
 *  - Foam block as rectangle from (0,0) to (L,W)
 *  - Cavities in that layer as rectangles
 */
function buildDxfForLayer(layout: any, layerIndex: number): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  let L = Number(block.lengthIn ?? block.length_in);
  let W = Number(block.widthIn ?? block.width_in);

  if (!Number.isFinite(L) || L <= 0) return null;
  if (!Number.isFinite(W) || W <= 0) {
    W = L; // defensive fallback
  }

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  // IMPORTANT: include Z coords (30/31) so CAD parses as proper R12 LINEs
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
    const left = L * cav.x;
    const top = W * cav.y;

    const cL = cav.lengthIn;
    const cW = cav.widthIn;

    entities.push(lineEntity(left, top, left + cL, top));
    entities.push(lineEntity(left + cL, top, left + cL, top + cW));
    entities.push(lineEntity(left + cL, top + cW, left, top + cW));
    entities.push(lineEntity(left, top + cW, left, top));
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
/**
 * This is intentionally simple and deterministic:
 * - Draw foam block outline
 * - Draw that layer’s cavity rectangles
 * - Uses layout.block length/width inches for viewBox
 *
 * NOTE: This is only for *admin preview clarity* and does not touch the
 * working SVG exporter that generates layoutPkg.svg_text.
 *
 * IMPORTANT: This preview currently renders cavities as rectangles (even if the cavity was a circle).
 * The STEP “square vs circle” issue is NOT solved here — that is in the STEP export path.
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

  const rects = cavs
    .map((c) => {
      const x = L * c.x;
      const y = W * c.y;
      const w = c.lengthIn;
      const h = c.widthIn;

      // Keep within bounds defensively (preview only)
      const x2 = Math.max(0, Math.min(L, x));
      const y2 = Math.max(0, Math.min(W, y));
      const w2 = Math.max(0, Math.min(L - x2, w));
      const h2 = Math.max(0, Math.min(W - y2, h));
      if (w2 <= 0 || h2 <= 0) return "";

      return `<rect x="${x2}" y="${y2}" width="${w2}" height="${h2}" fill="none" stroke="${cavStroke}" stroke-width="${Math.max(
        0.03,
        Math.min(L, W) / 300,
      )}" />`;
    })
    .filter(Boolean)
    .join("");

  const strokeWidth = Math.max(0.04, Math.min(L, W) / 250);

  // CRITICAL: width/height 100% so it scales to the preview panes reliably
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${W}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
    `<rect x="0" y="0" width="${L}" height="${W}" fill="#ffffff" stroke="${stroke}" stroke-width="${strokeWidth}" />`,
    rects,
    `</svg>`,
  ].join("");
}

/* ---------------- Component ---------------- */

export default function AdminQuoteClient({ quoteNo }: Props) {
  // Local quote number value: prefer prop, fall back to URL path.
  const [quoteNoValue, setQuoteNoValue] = React.useState<string>(quoteNo || "");

  const [loading, setLoading] = React.useState<boolean>(!!quoteNoValue);
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState<string | null>(null);
  const [quoteState, setQuoteState] = React.useState<QuoteRow | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(null);

  // Used to force a refetch (e.g., after rebuild-step)
  const [refreshTick, setRefreshTick] = React.useState<number>(0);

  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  // NEW: requested cartons for this quote (from quote_box_selections)
  const [boxSelections, setBoxSelections] = React.useState<RequestedBoxRow[] | null>(null);
  const [boxSelectionsLoading, setBoxSelectionsLoading] = React.useState<boolean>(false);
  const [boxSelectionsError, setBoxSelectionsError] = React.useState<string | null>(null);

  // NEW: rebuild-step UI state
  const [rebuildBusy, setRebuildBusy] = React.useState<boolean>(false);
  const [rebuildError, setRebuildError] = React.useState<string | null>(null);
  const [rebuildOkAt, setRebuildOkAt] = React.useState<string | null>(null);

  // NEW: layer selection (click a layer card, large preview follows)
  const [selectedLayerIdx, setSelectedLayerIdx] = React.useState<number>(0);

  // 🔁 Rescue quote_no from URL path if prop is missing/empty.
  // Expected path: /admin/quotes/<quote_no>
  React.useEffect(() => {
    if (quoteNoValue) return;
    if (typeof window === "undefined") return;

    try {
      const path = window.location.pathname || "";
      const parts = path.split("/").filter(Boolean); // e.g. ["admin", "quotes", "Q-AI-..."]
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

  // Fetch quote data from /api/quote/print when we have a quote number.
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

  // NEW: Fetch requested cartons (quote_box_selections) for this quote
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

  // Normalize SVG preview (full layout preview)
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

  // SVG + DXF blob downloads remain local (fine).
  const handleDownload = React.useCallback(
    (kind: "svg" | "dxf") => {
      if (typeof window === "undefined") return;
      if (!layoutPkg) return;

      let data: string | null = null;
      let ext = "";
      let mime = "";

      if (kind === "svg" && layoutPkg.svg_text) {
        data = layoutPkg.svg_text;
        ext = "svg";
        mime = "image/svg+xml";
      } else if (kind === "dxf" && layoutPkg.dxf_text) {
        data = layoutPkg.dxf_text;
        ext = "dxf";
        mime = "application/dxf";
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

  // STEP download uses the server endpoint directly.
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

  const primaryItem = items[0] || null;

  // Pricing metadata
  const primaryPricing = primaryItem?.pricing_meta || null;
  const minChargeApplied = !!primaryPricing?.used_min_charge;
  const setupFee = typeof primaryPricing?.setup_fee === "number" ? primaryPricing.setup_fee : null;
  const kerfPct = typeof primaryPricing?.kerf_pct === "number" ? primaryPricing.kerf_pct : null;
  const minChargeValue = typeof primaryPricing?.min_charge === "number" ? primaryPricing.min_charge : null;

  // shared card styles
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

  // derived material fields
  const primaryMaterialName =
    primaryItem?.material_name || (primaryItem ? `Material #${primaryItem.material_id}` : null);
  const primaryMaterialFamily = primaryItem?.material_family || null;
  const rawPrimaryDensity = primaryItem?.density_lb_ft3 ?? null;
  const primaryDensity = rawPrimaryDensity != null ? Number(rawPrimaryDensity) : null;
  const primaryDensityDisplay =
    primaryDensity != null && Number.isFinite(primaryDensity) ? primaryDensity.toFixed(2) : null;

  const customerQuoteUrl =
    quoteState?.quote_no && typeof window === "undefined"
      ? `/quote?quote_no=${encodeURIComponent(quoteState.quote_no)}`
      : quoteState?.quote_no
        ? `/quote?quote_no=${encodeURIComponent(quoteState.quote_no)}`
        : null;

  // Layers for per-layer tools/previews
  const layersForDxf = React.useMemo(
    () => (layoutPkg && layoutPkg.layout_json ? getLayersFromLayout(layoutPkg.layout_json) : []),
    [layoutPkg],
  );

  // Keep selection in range when the layout changes
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

  const handleDownloadLayerDxf = React.useCallback(
    (layerIndex: number) => {
      if (typeof window === "undefined") return;
      if (!layoutPkg || !layoutPkg.layout_json) return;

      const dxf = buildDxfForLayer(layoutPkg.layout_json, layerIndex);
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
    [layoutPkg, quoteState],
  );

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

      // Force refresh of /api/quote/print payload so admin UI reflects newest layoutPkg.step_text timestamp/notes/etc
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
              {!boxSelectionsLoading && boxSelectionsError && (
                <p style={{ fontSize: 12, color: "#b91c1c" }}>{boxSelectionsError}</p>
              )}
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
                          CAD downloads
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

                          {layoutPkg.dxf_text && layoutPkg.dxf_text.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleDownload("dxf")}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                border: "1px solid #e5e7eb",
                                background: "#f9fafb",
                                color: "#111827",
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: "pointer",
                              }}
                            >
                              Download DXF
                            </button>
                          )}

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

                    {/* Per-layer previews + buttons */}
                    {layersForDxf && layersForDxf.length > 0 && layoutPkg.layout_json && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>
                          Layers (preview + downloads)
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                            gap: 12,
                          }}
                        >
                          {layersForDxf.map((layer, idx) => {
                            const label = getLayerLabel(layer, idx);
                            const t = getLayerThicknessIn(layer);
                            const svg = buildSvgPreviewForLayer(layoutPkg.layout_json, idx);
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
                                    <div
                                      style={{ width: "100%", height: "100%", display: "flex" }}
                                      // safe here: we generate the svg string locally
                                      dangerouslySetInnerHTML={{ __html: svg }}
                                    />
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
                                      handleDownloadLayerDxf(idx);
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
                                      handleDownloadLayerStep(idx);
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
                          <div style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                            Selected layer preview:{" "}
                            <span style={{ fontWeight: 700 }}>
                              {getLayerLabel(layersForDxf[selectedLayerIdx] || null, selectedLayerIdx)} (Layer{" "}
                              {Math.min(selectedLayerIdx + 1, layersForDxf.length)}/{layersForDxf.length})
                            </span>
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

                    {/* Full-layout preview remains (useful) */}
                    {layoutPkg.svg_text && layoutPkg.svg_text.trim().length > 0 && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 8,
                          borderRadius: 10,
                          border: "1px solid #e5e7eb",
                          background: "#ffffff",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                          Full layout preview
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
                          dangerouslySetInnerHTML={{ __html: layoutPkg.svg_text }}
                        />
                      </div>
                    )}
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
