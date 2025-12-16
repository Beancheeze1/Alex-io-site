// app/quote/layout/page.tsx
//
// Layout editor host page (wide).
// - Left: palette + notes + closest cartons preview
// - Center: large canvas + metrics row under layout header
// - Right: inspector + customer info + cavities list
// - Apply-to-quote behavior unchanged
//
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { CavityShape, LayoutModel } from "./editor/layoutTypes";
import { useLayoutModel } from "./editor/useLayoutModel";
import InteractiveCanvas from "./editor/InteractiveCanvas";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

type MaterialOption = {
  id: number;
  name: string;
  family: string;
  density_lb_ft3: number | null;
};

// NEW: suggested box types for the box suggester panel
type SuggestedBox = {
  sku: string;
  description: string;
  style: string;
  vendor_name?: string | null;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  fit_score: number;
  notes?: string | null;
};

type BoxSuggestState = {
  loading: boolean;
  error: string | null;
  bestRsc: SuggestedBox | null;
  bestMailer: SuggestedBox | null;
};

/**
 * Normalize block dims from searchParams (dims= / block=)
 */
function normalizeDimsParam(raw: string | string[] | undefined): string {
  if (!raw) return "10x10x2";
  if (Array.isArray(raw)) {
    const first = raw.find((s) => s && s.trim());
    return first ? first.trim() : "10x10x2";
  }
  const trimmed = raw.trim();
  return trimmed || "10x10x2";
}

/**
 * Normalize cavity dims from searchParams (cavities= / cavity=)
 */
function normalizeCavitiesParam(raw: string | string[] | undefined): string {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    const cleaned = raw.map((s) => s.trim()).filter(Boolean);
    const unique: string[] = [];
    for (const val of cleaned) if (!unique.includes(val)) unique.push(val);
    return unique.join(";");
  }
  return raw.trim();
}

const SNAP_IN = 0.125;
const WALL_IN = 0.5;

/* Simple "LxWxH" parser */
function parseDimsTriple(
  raw: string | undefined | null,
): { L: number; W: number; H: number } | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/,
  );
  if (!m) return null;
  const L = Number(m[1]) || 0;
  const W = Number(m[2]) || 0;
  const H = Number(m[3]) || 0;
  if (!L || !W || !H) return null;
  return { L, W, H };
}

/* "LxW" or "LxWxD" parser (depth default 1") */
function parseCavityDims(raw: string): {
  L: number;
  W: number;
  D: number;
} | null {
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const num = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
  const tripleRe = new RegExp(`(${num})\\s*[x×]\\s*(${num})\\s*[x×]\\s*(${num})`);
  const doubleRe = new RegExp(`(${num})\\s*[x×]\\s*(${num})`);

  let m = t.match(tripleRe);
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    const D = Number(m[3]) || 0;
    if (!L || !W || !D) return null;
    return { L, W, D };
  }
  m = t.match(doubleRe);
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    if (!L || !W) return null;
    return { L, W, D: 1 };
  }
  return null;
}

function snapInches(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

/**
 * Path-A safety:
 * If the DB layout has a multi-layer stack but the quote does NOT look like a multi-layer quote,
 * collapse to a single layer so single-piece quotes don't show phantom stacks.
 */
function looksMultiLayerFromItems(items: any): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;

  // Heuristics only; we intentionally avoid guessing based on material strings.
  // We look for explicit layer fields commonly used in our quote_items payloads.
  const layerKeys = ["layer_index", "layer_no", "layerId", "layer_id", "layer_label", "layerLabel"];

  let foundExplicitLayerField = false;
  const indices = new Set<number>();

  for (const it of items) {
    if (!it || typeof it !== "object") continue;

    for (const k of layerKeys) {
      if (Object.prototype.hasOwnProperty.call(it, k) && it[k] != null && it[k] !== "") {
        foundExplicitLayerField = true;

        // collect numeric indices when available
        if (k === "layer_index" || k === "layer_no") {
          const n = Number(it[k]);
          if (Number.isFinite(n)) indices.add(n);
        }
      }
    }
  }

  // If we have 2+ distinct indices, it's definitely multi-layer.
  if (indices.size >= 2) return true;

  // If we have any explicit layer field present, treat it as multi-layer (conservative)
  return foundExplicitLayerField;
}

function collapseStackToSingleLayer(layoutFromDb: any): LayoutModel {
  try {
    const stack = Array.isArray(layoutFromDb?.stack) ? layoutFromDb.stack : null;
    if (!stack || stack.length === 0) return layoutFromDb as LayoutModel;

    const first = stack[0];
    const block = layoutFromDb?.block ?? { lengthIn: 10, widthIn: 10, thicknessIn: 2 };

    const t = Number(first?.thicknessIn);
    const thicknessIn =
      Number.isFinite(t) && t > 0 ? t : Number(block?.thicknessIn) || 0;

    // Keep first-layer cavities; this matches the single-piece expectation.
    const cavities = Array.isArray(first?.cavities) ? first.cavities : [];

    return {
      block: {
        ...block,
        thicknessIn: thicknessIn > 0 ? thicknessIn : (Number(block?.thicknessIn) || 2),
      },
      cavities,
    };
  } catch {
    return layoutFromDb as LayoutModel;
  }
}
export default function LayoutPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const initialQuoteNoParam = (searchParams?.quote_no ??
    searchParams?.quote ??
    "") as string | string[] | undefined;
  const [quoteNoFromUrl, setQuoteNoFromUrl] = React.useState<string>(
    Array.isArray(initialQuoteNoParam)
      ? initialQuoteNoParam[0]?.trim() || ""
      : initialQuoteNoParam?.trim() || "",
  );

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const q =
        url.searchParams.get("quote_no") || url.searchParams.get("quote") || "";
      if (q && q !== quoteNoFromUrl) setQuoteNoFromUrl(q);
    } catch {}
  }, []);

  /* ---------- Other URL params (dims, cavities) ---------- */

  const hasDimsFromUrl =
    typeof searchParams?.dims !== "undefined" ||
    typeof searchParams?.block !== "undefined";

  const hasCavitiesFromUrl =
    typeof searchParams?.cavities !== "undefined" ||
    typeof searchParams?.cavity !== "undefined";

  // Server-side / initial guesses from Next searchParams
  const serverBlockStr = normalizeDimsParam(
    (searchParams?.dims ??
      searchParams?.block) as string | string[] | undefined,
  );

  const serverCavityStr = normalizeCavitiesParam(
    (searchParams?.cavities ??
      searchParams?.cavity) as string | string[] | undefined,
  );

  const hasExplicitCavities = hasCavitiesFromUrl && serverCavityStr.length > 0;

  const hasRealQuoteNo = !!quoteNoFromUrl && quoteNoFromUrl.trim().length > 0;

  const quoteNo = hasRealQuoteNo ? quoteNoFromUrl.trim() : "Q-AI-EXAMPLE";
  const [materialIdFromUrl, setMaterialIdFromUrl] =
    React.useState<number | null>(() => {
      const raw = searchParams?.material_id as string | string[] | undefined;
      if (!raw) return null;
      const first = Array.isArray(raw) ? raw[0] : raw;
      const parsed = Number(first);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    });
  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const midRaw = url.searchParams.get("material_id");
      if (!midRaw) return;
      const parsed = Number(midRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      setMaterialIdFromUrl((prev) => (prev === parsed ? prev : parsed));
    } catch {
      // ignore
    }
  }, []);

  /* ---------- Build initial layout (from DB if available) ---------- */

  const [initialLayout, setInitialLayout] = React.useState<LayoutModel | null>(
    null,
  );
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(null);
  const [initialMaterialId, setInitialMaterialId] =
    React.useState<number | null>(null);

  // customer initial values (prefill from quote header when available)
  const [initialCustomerName, setInitialCustomerName] =
    React.useState<string>("");
  const [initialCustomerEmail, setInitialCustomerEmail] =
    React.useState<string>("");
  const [initialCustomerCompany, setInitialCustomerCompany] =
    React.useState<string>("");
  const [initialCustomerPhone, setInitialCustomerPhone] =
    React.useState<string>("");

  const [loadingLayout, setLoadingLayout] = React.useState<boolean>(true);

  /**
   * Fallback layout builder, driven by arbitrary dims/cavities strings.
   */
  const buildFallbackLayout = React.useCallback(
    (blockStr: string, cavityStr: string): LayoutModel => {
      // Block from dims=..., default 10x10x2 if missing.
      const parsedBlock = parseDimsTriple(blockStr) ?? {
        L: 10,
        W: 10,
        H: 2,
      };

      const block = {
        lengthIn: parsedBlock.L,
        widthIn: parsedBlock.W,
        thicknessIn: parsedBlock.H,
      };

      // Cavities from cavities=... string (can be "1x1x1;2x2x1" etc).
      const cavTokens = (cavityStr || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const cavities: LayoutModel["cavities"] = [];

      if (cavTokens.length > 0) {
        const parsedCavs = cavTokens
          .map((tok) => parseCavityDims(tok))
          .filter(Boolean) as { L: number; W: number; D: number }[];

        const count = parsedCavs.length;

        if (count > 0) {
          const cols = Math.ceil(Math.sqrt(count));
          const rows = Math.ceil(count / cols);

          const availW =
            Math.max(block.lengthIn - 2 * WALL_IN, 1) || block.lengthIn;
          const availH =
            Math.max(block.widthIn - 2 * WALL_IN, 1) || block.widthIn;

          const cellW = availW / cols;
          const cellH = availH / rows;

          parsedCavs.forEach((c, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            const rawX = WALL_IN + col * cellW + (cellW - c.L) / 2;
            const rawY = WALL_IN + row * cellH + (cellH - c.W) / 2;

            const clamp = (v: number, min: number, max: number) =>
              v < min ? min : v > max ? max : v;

            const minX = WALL_IN;
            const maxX = block.lengthIn - WALL_IN - c.L;
            const minY = WALL_IN;
            const maxY = block.widthIn - WALL_IN - c.W;

            const xIn = clamp(rawX, minX, Math.max(minX, maxX));
            const yIn = clamp(rawY, minY, Math.max(minY, maxY));

            const xNorm = block.lengthIn > 0 ? xIn / block.lengthIn : 0.1;
            const yNorm = block.widthIn > 0 ? yIn / block.widthIn : 0.1;

            cavities.push({
              id: `cav-${idx + 1}`,
              label: `${c.L}×${c.W}×${c.D} in`,
              shape: "rect",
              cornerRadiusIn: 0,
              lengthIn: c.L,
              widthIn: c.W,
              depthIn: c.D,
              x: xNorm,
              y: yNorm,
            });
          });
        }
      }

      // If we can’t build any cavities, just return a bare block.
      return {
        block,
        cavities,
      };
    },
    [],
  );
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      const materialIdOverride = materialIdFromUrl;
      setLoadingLayout(true);

      // Re-read dims/cavities from the actual address bar.
      let effectiveBlockStr = serverBlockStr;
      let effectiveCavityStr = serverCavityStr;

      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);

          const dimsCandidates: string[] = [];
          const dimsA = url.searchParams.get("dims");
          const dimsB = url.searchParams.get("block");
          if (dimsA) dimsCandidates.push(dimsA);
          if (!dimsA && dimsB) dimsCandidates.push(dimsB);

          const cavityParts: string[] = [];
          const cavitiesParams = url.searchParams
            .getAll("cavities")
            .filter((v) => v);
          const cavityParams = url.searchParams
            .getAll("cavity")
            .filter((v) => v);

          // Merge both sets (cavities + cavity), then dedupe via normalizeCavitiesParam.
          cavityParts.push(...cavitiesParams, ...cavityParams);

          if (dimsCandidates.length > 0) {
            effectiveBlockStr = normalizeDimsParam(dimsCandidates[0]);
          }

          if (cavityParts.length > 0) {
            effectiveCavityStr = normalizeCavitiesParam(cavityParts);
          }
        }
      } catch {
        // if anything goes wrong, we fall back to serverBlockStr/serverCavityStr
      }

      try {
        // If we don't have a real quote number, just use fallback layout
        if (!hasRealQuoteNo) {
          const fallback = buildFallbackLayout(
            effectiveBlockStr,
            effectiveCavityStr,
          );
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(null);
            setInitialMaterialId(materialIdOverride ?? null);
            // no header to pull customer info from in demo mode
            setInitialCustomerName("");
            setInitialCustomerEmail("");
            setInitialCustomerCompany("");
            setInitialCustomerPhone("");
            setLoadingLayout(false);
          }
          return;
        }
        // Try to fetch the latest layout package via /api/quote/print
        const res = await fetch(
          "/api/quote/print?quote_no=" +
            encodeURIComponent(quoteNoFromUrl.trim()),
          { cache: "no-store" },
        );

        if (!res.ok) {
          const fallback = buildFallbackLayout(
            effectiveBlockStr,
            effectiveCavityStr,
          );
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(null);
            setInitialMaterialId(materialIdOverride ?? null);
            setInitialCustomerName("");
            setInitialCustomerEmail("");
            setInitialCustomerCompany("");
            setInitialCustomerPhone("");
            setLoadingLayout(false);
          }
          return;
        }

        const json = await res.json();

        // Pull qty + material (+ thickness) from primary line item (if present)
        let qtyFromItems: number | null = null;
        let materialIdFromItems: number | null = null;
        let thicknessFromItems: number | null = null;

        if (Array.isArray(json.items) && json.items.length > 0) {
          const first = json.items[0];

          const rawQty = Number(first?.qty);
          if (Number.isFinite(rawQty) && rawQty > 0) {
            qtyFromItems = rawQty;
          }

          const mid = Number(first?.material_id);
          if (Number.isFinite(mid) && mid > 0) {
            materialIdFromItems = mid;
          }

          // Try to recover thickness from the foam line item.
          // Preferred: outside_size like "12x12x2"
          const outside = (first?.outside_size ?? first?.outsideSize ?? "") as string;
          const parsedOutside = parseDimsTriple(typeof outside === "string" ? outside : "");
          if (parsedOutside && Number.isFinite(parsedOutside.H) && parsedOutside.H > 0) {
            thicknessFromItems = parsedOutside.H;
          } else {
            // Fallback: explicit thickness fields if present
            const t =
              Number(first?.thickness_in) ||
              Number(first?.thicknessIn) ||
              Number(first?.thickness);
            if (Number.isFinite(t) && t > 0) thicknessFromItems = t;
          }
        }

        // If this is a real quote and we don't have a saved layoutPkg yet,
        // trust the quote item's thickness over whatever the URL passed.
        if (hasRealQuoteNo && thicknessFromItems && thicknessFromItems > 0) {
          const fromUrl = parseDimsTriple(effectiveBlockStr);
          if (fromUrl && fromUrl.L > 0 && fromUrl.W > 0) {
            effectiveBlockStr = `${fromUrl.L}x${fromUrl.W}x${thicknessFromItems}`;
          }
        }

        // pull customer info from quote header when present
        if (json && json.quote && typeof json.quote === "object") {
          const qh = json.quote as {
            customer_name?: string;
            email?: string | null;
            phone?: string | null;
          };

          if (!cancelled) {
            setInitialCustomerName((qh.customer_name ?? "").toString());
            setInitialCustomerEmail((qh.email ?? "").toString());
            // Company isn’t stored on quotes table yet; keep blank for now.
            setInitialCustomerCompany("");
            setInitialCustomerPhone((qh.phone ?? "").toString());
          }
        } else if (!cancelled) {
          // No header → clear initial customer fields
          setInitialCustomerName("");
          setInitialCustomerEmail("");
          setInitialCustomerCompany("");
          setInitialCustomerPhone("");
        }

        // Only use DB layout geometry when NO URL dims/cavities are present.
        if (
          json &&
          json.ok &&
          json.layoutPkg &&
          json.layoutPkg.layout_json &&
          !hasExplicitCavities &&
          !hasDimsFromUrl &&
          !hasCavitiesFromUrl
        ) {
          const layoutFromDbRaw = json.layoutPkg.layout_json as any;
          const notesFromDb =
            (json.layoutPkg.notes as string | null) ?? "";

          // Path-A: if DB has a multi-layer stack but the quote doesn't look layered, collapse it.
          let layoutFromDb: LayoutModel = layoutFromDbRaw as LayoutModel;

          const hasStack =
            Array.isArray(layoutFromDbRaw?.stack) && layoutFromDbRaw.stack.length > 1;

          const quoteLooksLayered = looksMultiLayerFromItems(json.items);

          if (hasStack && !quoteLooksLayered) {
            layoutFromDb = collapseStackToSingleLayer(layoutFromDbRaw);
          }

          if (!cancelled) {
            setInitialLayout(layoutFromDb);
            setInitialNotes(notesFromDb);
            setInitialQty(qtyFromItems);
            setInitialMaterialId(materialIdOverride ?? materialIdFromItems);
            setLoadingLayout(false);
          }
          return;
        }

        // Otherwise, use layout from URL (dims/cavities) and keep qty/material.
        const fallback = buildFallbackLayout(
          effectiveBlockStr,
          effectiveCavityStr,
        );
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(qtyFromItems);
          setInitialMaterialId(materialIdOverride ?? materialIdFromItems);
          setLoadingLayout(false);
        }
      } catch (err) {
        console.error("Error loading layout for /quote/layout:", err);
        const fallback = buildFallbackLayout(
          effectiveBlockStr,
          effectiveCavityStr,
        );
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(null);
          setInitialMaterialId(materialIdOverride ?? null);
          setInitialCustomerName("");
          setInitialCustomerEmail("");
          setInitialCustomerCompany("");
          setInitialCustomerPhone("");
          setLoadingLayout(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [
    hasRealQuoteNo,
    quoteNoFromUrl,
    buildFallbackLayout,
    hasExplicitCavities,
    hasDimsFromUrl,
    hasCavitiesFromUrl,
    serverBlockStr,
    serverCavityStr,
    materialIdFromUrl,
  ]);

  if (loadingLayout || !initialLayout) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),transparent_60%),radial-gradient(circle_at_bottom,_rgba(37,99,235,0.12),transparent_60%)]">
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.9)]">
          Loading layout preview&hellip;
        </div>
      </main>
    );
  }

  return (
    <LayoutEditorHost
      quoteNo={quoteNo}
      hasRealQuoteNo={hasRealQuoteNo}
      initialLayout={initialLayout}
      initialNotes={initialNotes}
      initialQty={initialQty}
      initialMaterialId={initialMaterialId}
      initialCustomerName={initialCustomerName}
      initialCustomerEmail={initialCustomerEmail}
      initialCustomerCompany={initialCustomerCompany}
      initialCustomerPhone={initialCustomerPhone}
    />
  );
}

const CAVITY_COLORS = [
  "#38bdf8",
  "#a855f7",
  "#f97316",
  "#22c55e",
  "#eab308",
  "#ec4899",
];

/* ---------- Layout editor host (main body) ---------- */

function ensureStack(layout: LayoutModel): LayoutModel {
  if ((layout as any).stack && Array.isArray((layout as any).stack)) {
    return layout;
  }

  const thickness =
    Number(layout.block?.thicknessIn) && Number(layout.block.thicknessIn) > 0
      ? Number(layout.block.thicknessIn)
      : 1;

  return {
    ...layout,
    stack: [
      {
        id: "layer-1",
        label: "Layer 1",
        thicknessIn: thickness,
        cavities: Array.isArray(layout.cavities) ? layout.cavities : [],
      },
    ],
  };
}









function LayoutEditorHost(props: {
  quoteNo: string;
  hasRealQuoteNo: boolean;
  initialLayout: LayoutModel;
  initialNotes: string;
  initialQty: number | null;
  initialMaterialId: number | null;
  initialCustomerName: string;
  initialCustomerEmail: string;
  initialCustomerCompany: string;
  initialCustomerPhone: string;
}) {
  const {
    quoteNo,
    hasRealQuoteNo,
    initialLayout,
    initialNotes,
    initialQty,
    initialMaterialId,
    initialCustomerName,
    initialCustomerEmail,
    initialCustomerCompany,
    initialCustomerPhone,
  } = props;

  const router = useRouter();

  const {
    layout,
    selectedId,
    activeLayerId,
    selectCavity,
    setActiveLayerId,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
    addLayer,
    renameLayer,
    deleteLayer,
  } = useLayoutModel(ensureStack(initialLayout));

  const { block, cavities, stack } = layout as LayoutModel & {
    stack?: {
      id: string;
      label: string;
      cavities: any[];
      thicknessIn?: number;
    }[];
  };

  const blockThicknessIn = Number(block.thicknessIn) || 0;

  // Thickness source of truth:
  // - layout.stack[].thicknessIn
  // - fallback: block.thicknessIn only for legacy / single-layer layouts without thicknessIn seeded
  const [thicknessTick, setThicknessTick] = React.useState(0);

  const getLayerThickness = React.useCallback(
    (layerId: string): number => {
      const layer =
        stack && stack.length > 0
          ? stack.find((l) => l.id === layerId) ?? null
          : null;

      const raw = layer ? Number(layer.thicknessIn) : NaN;
      if (Number.isFinite(raw) && raw > 0) return raw;

      return blockThicknessIn;
    },
    [stack, blockThicknessIn, thicknessTick],
  );

  const setLayerThicknessIn = React.useCallback(
    (layerId: string, nextThicknessIn: number) => {
      if (!stack || stack.length === 0) return;

      const layer = stack.find((l) => l.id === layerId);
      if (!layer) return;

      const snapped = snapInches(nextThicknessIn);
      if (!Number.isFinite(snapped) || snapped <= 0) return;

      layer.thicknessIn = snapped;

      // Force a re-render so inputs + derived totals update immediately.
      setThicknessTick((t) => t + 1);

      // Legacy/single-layer fallback rule: keep block thickness in sync when only one layer exists.
      if (stack.length === 1) {
        updateBlockDims({ thicknessIn: snapped });
      }
    },
    [stack, updateBlockDims],
  );

  // Seed missing per-layer thickness from block thickness (one-time / as stack changes).
  React.useEffect(() => {
    if (!stack || stack.length === 0) return;

    let changed = false;

    for (const layer of stack) {
      const raw = Number(layer.thicknessIn);
      if (!Number.isFinite(raw) || raw <= 0) {
        // fallback seed
        layer.thicknessIn = blockThicknessIn;
        changed = true;
      }
    }

    if (changed) {
      setThicknessTick((t) => t + 1);
    }
  }, [stack, blockThicknessIn]);

  const activeLayer =
    stack && stack.length > 0
      ? stack.find((layer) => layer.id === activeLayerId) ?? stack[0]
      : null;

  const activeLayerLabel = activeLayer?.label ?? null;
  const selectedCavity =
    cavities.find((c) => c.id === selectedId) || null;

  // Multi-layer: derive layers view if stack exists
  const layers = layout.stack && layout.stack.length > 0 ? layout.stack : null;

  const effectiveActiveLayerId =
    layers && layers.length > 0 ? activeLayerId ?? layers[0].id : null;

  // Total stack thickness used for box/carton suggestions.
  // Rule:
  // - No stack => use block thickness (legacy).
  // - 1+ layers => sum of stack[].thicknessIn (fallback per-layer to block thickness if missing).
  let totalStackThicknessIn = blockThicknessIn;

  if (stack && stack.length >= 1) {
    const sum = stack.reduce((acc, layer) => {
      const raw = Number(layer.thicknessIn);
      const t = Number.isFinite(raw) && raw > 0 ? raw : blockThicknessIn;
      return acc + t;
    }, 0);

    if (sum > 0) totalStackThicknessIn = sum;
  }

  // Ensure the hook actually has an active layer when a stack exists
  React.useEffect(() => {
    if (layers && layers.length > 0 && !activeLayerId) {
      setActiveLayerId(layers[0].id);
    }
  }, [layers, activeLayerId, setActiveLayerId]);

  // Clear selection when switching layers so we don't edit a cavity from a different layer
  const layerCount = layers?.length ?? 0;
  React.useEffect(() => {
    if (!layers || layerCount === 0) return;
    selectCavity(null);
  }, [effectiveActiveLayerId, layerCount, selectCavity, layers]);
  // When a new cavity is added, try to drop it into "dead space"
  const prevCavityCountRef = React.useRef<number>(cavities.length);
  React.useEffect(() => {
    const prevCount = prevCavityCountRef.current;

    if (
      cavities.length > prevCount &&
      block.lengthIn &&
      block.widthIn &&
      Number.isFinite(block.lengthIn) &&
      Number.isFinite(block.widthIn)
    ) {
      const newCavity = cavities[cavities.length - 1];
      if (newCavity) {
        const existing = cavities.slice(0, -1);

        const cavLen = Number(newCavity.lengthIn) || 1;
        const cavWid = Number(newCavity.widthIn) || 1;

        const usableLen = Math.max(block.lengthIn - 2 * WALL_IN, cavLen);
        const usableWid = Math.max(block.widthIn - 2 * WALL_IN, cavWid);

        const isOverlapping = (xIn: number, yIn: number) => {
          return existing.some((c) => {
            const cxIn = (Number(c.x) || 0) * block.lengthIn;
            const cyIn = (Number(c.y) || 0) * block.widthIn;
            const cLen = Number(c.lengthIn) || 0;
            const cWid = Number(c.widthIn) || 0;

            // Simple AABB overlap check
            return !(
              xIn + cavLen <= cxIn ||
              cxIn + cLen <= xIn ||
              yIn + cavWid <= cyIn ||
              cyIn + cWid <= yIn
            );
          });
        };

        let chosenXIn: number | null = null;
        let chosenYIn: number | null = null;

        const cols = 3;
        const rows = 3;
        const cellW = usableLen / cols;
        const cellH = usableWid / rows;

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const centerXIn = WALL_IN + cellW * (col + 0.5);
            const centerYIn = WALL_IN + cellH * (row + 0.5);

            let xIn = centerXIn - cavLen / 2;
            let yIn = centerYIn - cavWid / 2;

            const minXIn = WALL_IN;
            const maxXIn = block.lengthIn - WALL_IN - cavLen;
            const minYIn = WALL_IN;
            const maxYIn = block.widthIn - WALL_IN - cavWid;

            const clamp = (v: number, min: number, max: number) =>
              v < min ? min : v > max ? max : v;

            xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
            yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

            if (!isOverlapping(xIn, yIn)) {
              chosenXIn = xIn;
              chosenYIn = yIn;
              break;
            }
          }
          if (chosenXIn != null) break;
        }

        // Fallback: center placement inside walls
        if (chosenXIn == null || chosenYIn == null) {
          let xIn = (block.lengthIn - cavLen) / 2;
          let yIn = (block.widthIn - cavWid) / 2;

          const minXIn = WALL_IN;
          const maxXIn = block.lengthIn - WALL_IN - cavLen;
          const minYIn = WALL_IN;
          const maxYIn = block.widthIn - WALL_IN - cavWid;

          const clamp = (v: number, min: number, max: number) =>
            v < min ? min : v > max ? max : v;

          xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
          yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

          chosenXIn = xIn;
          chosenYIn = yIn;
        }

        if (
          chosenXIn != null &&
          chosenYIn != null &&
          block.lengthIn > 0 &&
          block.widthIn > 0
        ) {
          const xNorm = chosenXIn / block.lengthIn;
          const yNorm = chosenYIn / block.widthIn;
          updateCavityPosition(newCavity.id, xNorm, yNorm);
        }
      }
    }

    prevCavityCountRef.current = cavities.length;
  }, [cavities, block.lengthIn, block.widthIn, updateCavityPosition]);

  // Handle edits to the active layer's thickness
  const handleActiveLayerThicknessChange = (value: string) => {
    if (!activeLayer) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setLayerThicknessIn(activeLayer.id, num);
  };

  const [zoom, setZoom] = React.useState(1);
  const [croppedCorners, setCroppedCorners] = React.useState(false);
  const [notes, setNotes] = React.useState(initialNotes || "");
  const [applyStatus, setApplyStatus] = React.useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [qty, setQty] = React.useState<number | "">(
    initialQty != null ? initialQty : "",
  );

  // Customer info
  const [customerName, setCustomerName] = React.useState<string>(
    initialCustomerName || "",
  );
  const [customerEmail, setCustomerEmail] = React.useState<string>(
    initialCustomerEmail || "",
  );
  const [customerCompany, setCustomerCompany] = React.useState<string>(
    initialCustomerCompany || "",
  );
  const [customerPhone, setCustomerPhone] = React.useState<string>(
    initialCustomerPhone || "",
  );

  const [materials, setMaterials] = React.useState<MaterialOption[]>([]);
  const [materialsLoading, setMaterialsLoading] =
    React.useState<boolean>(true);
  const [materialsError, setMaterialsError] = React.useState<string | null>(
    null,
  );
  const [selectedMaterialId, setSelectedMaterialId] =
    React.useState<number | null>(initialMaterialId);

  // Box suggester state (RSC + mailer suggestions)
  const [boxSuggest, setBoxSuggest] = React.useState<BoxSuggestState>({
    loading: false,
    error: null,
    bestRsc: null,
    bestMailer: null,
  });

  const [selectedCartonKind, setSelectedCartonKind] =
    React.useState<"RSC" | "MAILER" | null>(null);
  const handlePickCarton = React.useCallback(
    async (kind: "RSC" | "MAILER") => {
      // Update the visual selection immediately
      setSelectedCartonKind(kind);

      const sku =
        kind === "RSC"
          ? boxSuggest.bestRsc?.sku
          : boxSuggest.bestMailer?.sku;

      // We need a quote number and a SKU to do anything useful
      if (!quoteNo || !sku) {
        console.warn("[layout] Skipping carton pick: missing quoteNo or sku", {
          quoteNo,
          sku,
        });
        return;
      }

      // Use the same qty as the layout / primary foam line, defaulting to 1
      const numericQty =
        typeof qty === "number" && Number.isFinite(qty) && qty > 0
          ? qty
          : 1;

      const payload = {
        quote_no: quoteNo,
        sku,
        qty: numericQty,
      };

      console.log("[layout] handlePickCarton → /api/boxes/add-to-quote", payload);

      try {
        const res = await fetch("/api/boxes/add-to-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res
          .json()
          .catch(() => ({ ok: false, error: "non_json_response" }));

        console.log(
          "[layout] /api/boxes/add-to-quote response",
          res.status,
          data,
        );

        if (!res.ok) {
          console.error(
            "Failed to add box to quote",
            res.status,
            data,
          );
        }
      } catch (err) {
        console.error(
          "Error in handlePickCarton /api/boxes/add-to-quote",
          err,
        );
      }
    },
    [boxSuggest.bestRsc, boxSuggest.bestMailer, quoteNo, qty],
  );

  // Local input state for selected cavity dims (to avoid "wonky" inputs)
  const [cavityInputs, setCavityInputs] = React.useState<{
    id: string | null;
    length: string;
    width: string;
    depth: string;
    cornerRadius: string;
  }>(/* ... unchanged ... */{
    id: null,
    length: "",
    width: "",
    depth: "",
    cornerRadius: "",
  });

  React.useEffect(() => {
    if (!selectedCavity) {
      setCavityInputs({
        id: null,
        length: "",
        width: "",
        depth: "",
        cornerRadius: "",
      });
      return;
    }

    setCavityInputs({
      id: selectedCavity.id,
      length:
        selectedCavity.lengthIn != null
          ? String(selectedCavity.lengthIn)
          : "",
      width:
        selectedCavity.widthIn != null ? String(selectedCavity.widthIn) : "",
      depth:
        selectedCavity.depthIn != null ? String(selectedCavity.depthIn) : "",
      cornerRadius:
        selectedCavity.cornerRadiusIn != null
          ? String(selectedCavity.cornerRadiusIn)
          : "",
    });
  }, [selectedCavity]);

  const commitCavityField = React.useCallback(
    (field: "length" | "width" | "depth" | "cornerRadius") => {
      if (
        !selectedCavity ||
        !cavityInputs.id ||
        cavityInputs.id !== selectedCavity.id
      ) {
        return;
      }

      const raw = cavityInputs[field];
      const parsed = Number(raw);

      const resetToCurrent = () => {
        setCavityInputs((prev) => ({
          ...prev,
          [field]:
            field === "length"
              ? String(selectedCavity.lengthIn ?? "")
              : field === "width"
              ? String(selectedCavity.widthIn ?? "")
              : field === "depth"
              ? String(selectedCavity.depthIn ?? "")
              : String(selectedCavity.cornerRadiusIn ?? ""),
        }));
      };

      if (!Number.isFinite(parsed) || parsed <= 0) {
        resetToCurrent();
        return;
      }

      const snapped = snapInches(parsed);

      // Circles keep length/width as the same "diameter"
      if (
        selectedCavity.shape === "circle" &&
        (field === "length" || field === "width")
      ) {
        updateCavityDims(selectedCavity.id, {
          lengthIn: snapped,
          widthIn: snapped,
        });
        setCavityInputs((prev) => ({
          ...prev,
          length: String(snapped),
          width: String(snapped),
        }));
        return;
      }

      if (field === "length") {
        updateCavityDims(selectedCavity.id, { lengthIn: snapped });
        setCavityInputs((prev) => ({ ...prev, length: String(snapped) }));
      } else if (field === "width") {
        updateCavityDims(selectedCavity.id, { widthIn: snapped });
        setCavityInputs((prev) => ({ ...prev, width: String(snapped) }));
      } else if (field === "depth") {
        updateCavityDims(selectedCavity.id, { depthIn: snapped });
        setCavityInputs((prev) => ({ ...prev, depth: String(snapped) }));
      } else {
        updateCavityDims(selectedCavity.id, {
          cornerRadiusIn: snapped,
        });
        setCavityInputs((prev) => ({
          ...prev,
          cornerRadius: String(snapped),
        }));
      }
    },
    [cavityInputs, selectedCavity, updateCavityDims],
  );

  // (materials load / grouping unchanged...)

  const missingCustomerInfo =
    !customerName.trim() || !customerEmail.trim();

  /* ---------- Palette interactions ---------- */

  const handleAddPreset = (shape: CavityShape) => {
    if (shape === "circle") {
      addCavity("circle", { lengthIn: 3, widthIn: 3, depthIn: 2 });
    } else if (shape === "roundedRect") {
      addCavity("roundedRect", {
        lengthIn: 4,
        widthIn: 3,
        depthIn: 2,
        cornerRadiusIn: 0.5,
      });
    } else {
      addCavity("rect", { lengthIn: 4, widthIn: 2, depthIn: 2 });
    }
  };

  /* ---------- Center selected cavity ---------- */
  const handleCenterSelectedCavity = () => {
    if (!selectedCavity) return;

    const len = selectedCavity.lengthIn;
    const wid = selectedCavity.widthIn;

    if (!block.lengthIn || !block.widthIn || !len || !wid) return;

    let xIn = (block.lengthIn - len) / 2;
    let yIn = (block.widthIn - wid) / 2;

    xIn = snapInches(xIn);
    yIn = snapInches(yIn);

    const minXIn = WALL_IN;
    const maxXIn = block.lengthIn - WALL_IN - len;
    const minYIn = WALL_IN;
    const maxYIn = block.widthIn - WALL_IN - wid;

    const clamp = (v: number, min: number, max: number) =>
      v < min ? min : v > max ? max : v;

    xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
    yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

    const xNorm = xIn / block.lengthIn;
    const yNorm = yIn / block.widthIn;

    updateCavityPosition(selectedCavity.id, xNorm, yNorm);
  };

  /* ---------- Foam Advisor navigation ---------- */

  const handleGoToFoamAdvisor = () => {
    if (missingCustomerInfo) return;

    const params = new URLSearchParams();

    if (hasRealQuoteNo && quoteNo) {
      params.set("quote_no", quoteNo);
    }

    const L = Number(block.lengthIn) || 0;
    const W = Number(block.widthIn) || 0;
    const T = Number(block.thicknessIn) || 0;

    if (L > 0 && W > 0 && T >= 0) {
      params.set("block", `${L}x${W}x${T}`);
    }

    const query = params.toString();
    const url = query ? `/foam-advisor?${query}` : "/foam-advisor";

    router.push(url);
  };

  /* ---------- Apply-to-Quote ---------- */

  const handleApplyToQuote = async () => {
    if (!hasRealQuoteNo) {
      alert(
        "This layout isn’t linked to a quote.\nOpen from a real quote email.",
      );
      return;
    }

    if (missingCustomerInfo) {
      alert("Add customer name + email before applying to quote.");
      return;
    }

    try {
      setApplyStatus("saving");

      const selectedMaterial =
        selectedMaterialId != null
          ? materials.find((m) => m.id === selectedMaterialId) || null
          : null;

      let materialLabel: string | null = null;
      if (selectedMaterial) {
        const familyLabel =
          (selectedMaterial.family && selectedMaterial.family.trim()) ||
          (selectedMaterial.name && selectedMaterial.name.trim()) ||
          "";

        let densityLabel: string | null = null;
        if (
          typeof selectedMaterial.density_lb_ft3 === "number" &&
          Number.isFinite(selectedMaterial.density_lb_ft3)
        ) {
          densityLabel = `${selectedMaterial.density_lb_ft3.toFixed(1)} pcf`;
        }

        materialLabel = densityLabel
          ? `${familyLabel}, ${densityLabel}`
          : familyLabel || null;
      }

      const svg = buildSvgFromLayout(layout, {
        notes:
          notes && notes.trim().length > 0 ? notes.trim() : undefined,
        materialLabel: materialLabel || undefined,
      });

      const payload: any = {
        quoteNo,
        layout,
        notes,
        svg,
        customer: {
          name: customerName.trim(),
          email: customerEmail.trim(),
          company: customerCompany.trim() || null,
          phone: customerPhone.trim() || null,
        },
      };

      // Attach chosen carton (if any) so the backend can add a box line item
      if (selectedCartonKind && (boxSuggest.bestRsc || boxSuggest.bestMailer)) {
        const chosen =
          selectedCartonKind === "RSC"
            ? boxSuggest.bestRsc
            : boxSuggest.bestMailer;

        if (chosen) {
          payload.selectedCarton = {
            style: chosen.style,
            sku: chosen.sku,
            description: chosen.description,
            inside_length_in: chosen.inside_length_in,
            inside_width_in: chosen.inside_width_in,
            inside_height_in: chosen.inside_height_in,
            fit_score: chosen.fit_score,
            notes: chosen.notes ?? null,
          };
        }
      }

      // Attach foam layers summary so the backend can add each pad as a line item
      // PATH-A FIX: only send foamLayers when there are 2+ layers (avoid triggering layered logic for single-piece quotes).
      if (layers && layers.length > 1) {
        payload.foamLayers = layers.map((layer) => ({
          id: layer.id,
          label: layer.label,
          thicknessIn: getLayerThickness(layer.id),
        }));
      }

      const nQty = Number(qty);
      if (Number.isFinite(nQty) && nQty > 0) {
        payload.qty = nQty;
      }
      if (selectedMaterialId != null) {
        payload.materialId = selectedMaterialId;
      }

      const res = await fetch("/api/quote/layout/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let payloadJson: any = null;
        try {
          payloadJson = await res.json();
          if (payloadJson?.error === "quote_not_found") {
            alert(
              `Couldn’t find a quote header for ${quoteNo}.\nOpen this link from a real quote email.`,
            );
          }
        } catch {
          // ignore
        }
        throw new Error(`HTTP ${res.status}`);
      }

      if (typeof window !== "undefined") {
        window.location.href =
          "/quote?quote_no=" + encodeURIComponent(quoteNo);
        return;
      }

      setApplyStatus("done");
      setTimeout(() => setApplyStatus("idle"), 2000);
    } catch (err) {
      console.error("Apply-to-quote failed", err);
      setApplyStatus("error");
      setTimeout(() => setApplyStatus("idle"), 3000);
    }
  };

  /* ---------- Layout ---------- */

  const canApplyButton =
    hasRealQuoteNo && !missingCustomerInfo && applyStatus !== "saving";

  // Qty used for box/carton suggestions (null when not set)
  const effectiveQty =
    typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : null;

  // (box suggester effect + labels unchanged...)

  const footprintLabel =
    Number(block.lengthIn) > 0 && Number(block.widthIn) > 0
      ? `${Number(block.lengthIn).toFixed(2)}" × ${Number(
          block.widthIn,
        ).toFixed(2)}"`
      : "—";

  const stackDepthLabel =
    totalStackThicknessIn > 0 ? `${totalStackThicknessIn.toFixed(2)}"` : "—";

  const qtyLabel =
    effectiveQty != null ? effectiveQty.toLocaleString() : "—";

  const suggesterReady =
    hasRealQuoteNo &&
    !missingCustomerInfo &&
    Number(block.lengthIn) > 0 &&
    Number(block.widthIn) > 0 &&
    totalStackThicknessIn > 0;

  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),transparent_60%),radial-gradient(circle_at_bottom,_rgba(37,99,235,0.14),transparent_60%)] flex items-stretch py-8 px-4">
      <div className="w-full max-w-none mx-auto">
        <div className="relative rounded-2xl border border-slate-800/80 bg-slate-950/90 shadow-[0_26px_60px_rgba(15,23,42,0.95)] overflow-hidden">
          {/* global grid/glow overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-65 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),transparent_55%),linear-gradient(to_right,rgba(15,23,42,0.95)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.95)_1px,transparent_1px)] [background-size:460px_460px,28px_28px,28px_28px]"
          />
          <div className="relative">
            {/* Header */}
            {/* ... unchanged header/metrics/body until carton buttons ... */}
            {/* Body: three-column layout */}
            <div className="flex flex-row gap-5 p-5 bg-slate-950/90 text-slate-100 min-h-[620px]">
              {/* LEFT: Cavity palette + material + cartons + notes */}
              <aside className="w-52 shrink-0 flex flex-col gap-3">
                {/* ... unchanged ... */}

                {/* Closest matching cartons (live suggester, always visible) */}
                <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/85 p-3">
                  {/* ... unchanged ... */}

                  {!suggesterReady ? (
                    /* ... unchanged ... */
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
                      <div className="font-semibold text-slate-100 mb-1">
                        Waiting for layout &amp; customer info…
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li>Set block length, width and stack depth.</li>
                        <li>Enter customer name + email.</li>
                        {hasRealQuoteNo ? null : <li>Link this layout to a real quote.</li>}
                      </ul>
                    </div>
                  ) : boxSuggest.loading ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200">
                      Calculating best-fit cartons…
                    </div>
                  ) : boxSuggest.error ? (
                    <div className="rounded-xl border border-amber-500/70 bg-amber-900/40 px-3 py-2 text-[11px] text-amber-50">
                      {boxSuggest.error}
                    </div>
                  ) : !boxSuggest.bestRsc && !boxSuggest.bestMailer ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
                      No good carton matches found in the current stub catalog.
                    </div>
                  ) : (
                    <div className="space-y-2 text-[11px]">
                      {boxSuggest.bestRsc && (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2">
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="font-semibold text-slate-100">Best RSC match</div>
                            <span className="font-mono text-sky-300 text-[10px]">
                              {boxSuggest.bestRsc.sku}
                            </span>
                          </div>
                          <div className="text-slate-300">{boxSuggest.bestRsc.description}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-400">
                            <span>
                              Inside{" "}
                              <span className="font-mono text-slate-50">
                                {boxSuggest.bestRsc.inside_length_in}" ×{" "}
                                {boxSuggest.bestRsc.inside_width_in}" ×{" "}
                                {boxSuggest.bestRsc.inside_height_in}"
                              </span>
                            </span>
                            <span className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200">
                              Fit score: {boxSuggest.bestRsc.fit_score}
                            </span>
                          </div>

                          {boxSuggest.bestRsc.notes && (
                            <div className="mt-0.5 text-slate-400">{boxSuggest.bestRsc.notes}</div>
                          )}

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handlePickCarton("RSC")}
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                                selectedCartonKind === "RSC"
                                  ? "border-sky-400 bg-sky-500/20 text-sky-50"
                                  : "border-slate-600 bg-slate-950/60 text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10"
                              }`}
                            >
                              {selectedCartonKind === "RSC" ? "Selected carton" : "Pick this box"}
                            </button>
                          </div>
                        </div>
                      )}

                      {boxSuggest.bestMailer && (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2">
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="font-semibold text-slate-100">Best mailer match</div>
                            <span className="font-mono text-sky-300 text-[10px]">
                              {boxSuggest.bestMailer.sku}
                            </span>
                          </div>
                          <div className="text-slate-300">
                            {boxSuggest.bestMailer.description}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-400">
                            <span>
                              Inside{" "}
                              <span className="font-mono text-slate-50">
                                {boxSuggest.bestMailer.inside_length_in}" ×{" "}
                                {boxSuggest.bestMailer.inside_width_in}" ×{" "}
                                {boxSuggest.bestMailer.inside_height_in}"
                              </span>
                            </span>
                            <span className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200">
                              Fit score: {boxSuggest.bestMailer.fit_score}
                            </span>
                          </div>

                          {boxSuggest.bestMailer.notes && (
                            <div className="mt-0.5 text-slate-400">
                              {boxSuggest.bestMailer.notes}
                            </div>
                          )}

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handlePickCarton("MAILER")}
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                                selectedCartonKind === "MAILER"
                                  ? "border-sky-400 bg-sky-500/20 text-sky-50"
                                  : "border-slate-600 bg-slate-950/60 text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10"
                              }`}
                            >
                              {selectedCartonKind === "MAILER"
                                ? "Selected carton"
                                : "Pick this box"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ... rest of file unchanged ... */}
              </aside>

              {/* CENTER + RIGHT sections unchanged ... */}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}





/* ---------- SVG export helper ---------- */

function buildSvgFromLayout(
  layout: LayoutModel,
  meta?: { notes?: string; materialLabel?: string | null },
): string {
  const { block, cavities } = layout;

  const L = Number(block.lengthIn) || 0;
  const W = Number(block.widthIn) || 0;
  const T = Number(block.thicknessIn) || 0;

  const VIEW_W = 1000;
  const VIEW_H = 700;
  const PADDING = 40;

  if (L <= 0 || W <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}"></svg>`;
  }

  const scaleX = (VIEW_W - 2 * PADDING) / L;
  const scaleY = (VIEW_H - 2 * PADDING) / W;
  const scale = Math.min(scaleX, scaleY);

  const blockW = L * scale;
  const blockH = W * scale;
  const blockX = (VIEW_W - blockW) / 2;
  const blockY = (VIEW_H - blockH) / 2;

  const escapeText = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const cavects: string[] = [];

  for (const c of cavities) {
    const cavW = c.lengthIn * scale;
    const cavH = c.widthIn * scale;
    const x = blockX + c.x * blockW;
    const y = blockY + c.y * blockH;

    const label = c.label ?? `${c.lengthIn}×${c.widthIn}×${c.depthIn}"`;

    if (c.shape === "circle") {
      const r = Math.min(cavW, cavH) / 2;
      const cx = x + cavW / 2;
      const cy = y + cavH / 2;
      cavects.push(
        [
          `<g>`,
          `  <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(
            2,
          )}" r="${r.toFixed(
            2,
          )}" fill="none" stroke="#111827" stroke-width="1" />`,
          `  <text x="${cx.toFixed(
            2,
          )}" y="${cy.toFixed(
            2,
          )}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#111827">${escapeText(
            label,
          )}</text>`,
          `</g>`,
        ].join("\n"),
      );
    } else {
      cavects.push(
        [
          `<g>`,
          `  <rect x="${x.toFixed(
            2,
          )}" y="${y.toFixed(
            2,
          )}" width="${cavW.toFixed(
            2,
          )}" height="${cavH.toFixed(
            2,
          )}" rx="0" ry="0" fill="none" stroke="#111827" stroke-width="1" />`,
          `  <text x="${(x + cavW / 2).toFixed(
            2,
          )}" y="${(y + cavH / 2).toFixed(
            2,
          )}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#111827">${escapeText(
            label,
          )}</text>`,
          `</g>`,
        ].join("\n"),
      );
    }
  }

  const cavRects = cavects.join("\n");

  const headerLines: string[] = [];
  headerLines.push("NOT TO SCALE");
  if (T > 0) {
    headerLines.push(`BLOCK: ${L}" × ${W}" × ${T}"`);
  } else {
    headerLines.push(`BLOCK: ${L}" × ${W}" (thickness see quote)`);
  }

  if (meta?.materialLabel) {
    headerLines.push(`MATERIAL: ${meta.materialLabel}`);
  }

  const headerTexts = headerLines
    .map((line, idx) => {
      const y = PADDING + idx * 14;
      const fontSize = idx === 0 ? 11 : 10;
      return `<text x="${PADDING.toFixed(
        2,
      )}" y="${y.toFixed(
        2,
      )}" font-size="${fontSize}" fill="#111827">${escapeText(
        line,
      )}</text>`;
    })
    .join("\n    ");

  const headerSection = `<g>
    ${headerTexts}
  </g>`;

  const metaLines: string[] = [];

  if (meta?.notes && meta.notes.trim().length > 0) {
    const rawNotes = meta.notes.trim();

    const cleaned = rawNotes
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !/^FOAM(?:\s+BLOCK)?:/i.test(line) &&
          !/^BLOCK:/i.test(line) &&
          !/^CAVITY/i.test(line) &&
          !/^FOAM:/i.test(line) &&
          !/^MATERIAL:/i.test(line),
      );

    if (cleaned.length > 0) {
      metaLines.push(`Notes: ${cleaned.join("  ")}`);
    }
  }

  let metaSection = "";
  if (metaLines.length > 0) {
    const notesTexts = metaLines
      .map((line, idx) => {
        const y = VIEW_H - PADDING + idx * 14;
        return `<text x="${PADDING.toFixed(
          2,
        )}" y="${y.toFixed(
          2,
        )}" font-size="10" fill="#111827">${escapeText(
          line,
        )}</text>`;
      })
      .join("\n    ");

    metaSection = `<g>
    ${notesTexts}
  </g>`;
  }

  const svgParts: string[] = [];

  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">`,
  );

  svgParts.push(`  ${headerSection}`);

  svgParts.push(
    `  <rect x="${blockX.toFixed(
      2,
    )}" y="${blockY.toFixed(
      2,
    )}" width="${blockW.toFixed(
      2,
    )}" height="${blockH.toFixed(
      2,
    )}" rx="0" ry="0" fill="#e5e7eb" stroke="#111827" stroke-width="2" />`,
  );

  if (cavRects) {
    svgParts.push(cavRects);
  }

  if (metaSection) {
    svgParts.push(metaSection);
  }

  svgParts.push(`</svg>`);

  return svgParts.join("\n");
}
