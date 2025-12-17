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

type LayerIntent = {
  thicknesses: number[];
  labels: string[];
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

/**
 * NEW: Accept "layer_thicknesses" + "layer_count" params (from email links)
 * and convert them into the same shape as parseLayersParam expects.
 *
 * Examples:
 *  - layer_thicknesses=1,4,1
 *  - layer_thicknesses=1;4;1
 *  - layer_count=3 (thicknesses missing → we’ll still create 3 layers later if needed)
 */
function readLayersFromSearchParams(
  sp: SearchParams | undefined,
): { thicknesses: number[]; labels: string[] } | null {
  // 1) Prefer existing supported params
  const rawLayers = (sp?.layers ?? (sp as any)?.layer) as
    | string
    | string[]
    | undefined;

  const parsedDirect =
    typeof parseLayersParam === "function" ? parseLayersParam(rawLayers) : null;

  if (parsedDirect) return parsedDirect;

  // 2) Support the actual email params you’re using now
  const rawThicknesses = sp?.layer_thicknesses as string | string[] | undefined;
  const first = Array.isArray(rawThicknesses)
    ? rawThicknesses.find((s) => s && s.trim())
    : rawThicknesses;

  if (first && first.trim()) {
    const parts = first
      .trim()
      .split(/[;,|]/)
      .map((x) => x.trim())
      .filter(Boolean);

    const thicknesses = parts
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (thicknesses.length > 0) {
      const labels = thicknesses.map((_, i) => `Layer ${i + 1}`);
      return { thicknesses, labels };
    }
  }

  // 3) If we only have layer_count, return null here; we’ll handle it where we know block thickness.
  return null;
}

/**
 * Normalize layers from searchParams / URL
 * Supports:
 *  - layers=1,4,1
 *  - layers=1;4;1
 *  - layer=1&layer=4&layer=1
 *  - layers=[{"thicknessIn":1,"label":"Bottom"},{"thicknessIn":4,"label":"Middle"},{"thicknessIn":1,"label":"Top"}]
 */
function parseLayersParam(
  raw: string | string[] | undefined,
): { thicknesses: number[]; labels: string[] } | null {
  if (!raw) return null;

  // If repeated params, join them
  const first = Array.isArray(raw) ? raw.find((s) => s && s.trim()) : raw;
  if (!first) return null;

  const s = first.trim();
  if (!s) return null;

  // JSON forms
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s);

      // Array of objects
      if (Array.isArray(parsed)) {
        const thicknesses: number[] = [];
        const labels: string[] = [];

        for (const item of parsed) {
          const t = Number(item?.thicknessIn ?? item?.thickness ?? item?.t);
          if (Number.isFinite(t) && t > 0) {
            thicknesses.push(t);
            const lbl = (item?.label ?? item?.name ?? "").toString().trim();
            labels.push(lbl || `Layer ${thicknesses.length}`);
          }
        }

        return thicknesses.length > 0 ? { thicknesses, labels } : null;
      }

      // Object with thicknesses array
      if (parsed && typeof parsed === "object") {
        const arr = (parsed as any).thicknesses ?? (parsed as any).layers ?? null;
        if (Array.isArray(arr)) {
          const thicknesses = arr
            .map((x: any) => Number(x))
            .filter((n: number) => Number.isFinite(n) && n > 0);

          if (thicknesses.length === 0) return null;
          const labels = thicknesses.map((_, i) => `Layer ${i + 1}`);
          return { thicknesses, labels };
        }
      }
    } catch {
      // fall through to delimited
    }
  }

  // Delimited numeric list
  const parts = s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
  const thicknesses = parts
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (thicknesses.length === 0) return null;

  const labels = thicknesses.map((_, i) => `Layer ${i + 1}`);
  return { thicknesses, labels };
}

/**
 * Layer-aware fallback layout builder:
 * - builds layout.stack[] when layers are present in the URL
 * - puts any URL cavities into the FIRST layer (safe/default)
 * - keeps layout.cavities in sync with active layer (layer 1 initially)
 */
function buildLayeredFallbackLayout(
  blockStr: string,
  cavityStr: string,
  thicknesses: number[],
  labels: string[],
): LayoutModel & {
  stack: {
    id: string;
    label: string;
    cavities: LayoutModel["cavities"];
    thicknessIn: number;
  }[];
} {
  const parsedBlock = parseDimsTriple(blockStr) ?? { L: 10, W: 10, H: 2 };

  const block = {
    lengthIn: parsedBlock.L,
    widthIn: parsedBlock.W,
    // IMPORTANT: for multi-layer, store TOTAL thickness here (keeps outside-size math sane)
    thicknessIn: thicknesses.reduce((a, b) => a + b, 0),
  };

  // Build cavities from generic cavities string (we seed them into layer 1)
  const cavTokens = (cavityStr || "")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const firstLayerCavities: LayoutModel["cavities"] = [];

  if (cavTokens.length > 0) {
    const parsedCavs = cavTokens
      .map((tok) => parseCavityDims(tok))
      .filter(Boolean) as { L: number; W: number; D: number }[];

    const count = parsedCavs.length;

    if (count > 0) {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      const availW = Math.max(block.lengthIn - 2 * WALL_IN, 1) || block.lengthIn;
      const availH = Math.max(block.widthIn - 2 * WALL_IN, 1) || block.widthIn;

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

        firstLayerCavities.push({
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

  const stack = thicknesses.map((t, i) => ({
    id: `layer-${i + 1}`,
    label: labels[i] || `Layer ${i + 1}`,
    thicknessIn: t,
    cavities: i === 0 ? firstLayerCavities : [],
  }));

  // IMPORTANT: layout.cavities should reflect active layer (layer 1 on load)
  return {
    block,
    cavities: stack[0]?.cavities ?? [],
    stack,
  };
}

const SNAP_IN = 0.125;
const WALL_IN = 0.5;

/**
 * Layer params from URL:
 *  - layer_count=3
 *  - layer_thicknesses=1,4,1   (or 1;4;1)
 *  - layer_cavity_layer_index=2   (1-based index of which layer gets the URL cavities)
 */
function parseLayerCountParam(raw: string | string[] | undefined): number | null {
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw.find((s) => s && s.trim()) : raw;
  if (!first) return null;
  const n = Number(String(first).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function parseLayerThicknessesParam(
  raw: string | string[] | undefined,
): number[] | null {
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw.find((s) => s && s.trim()) : raw;
  if (!first) return null;

  const s = String(first).trim();
  if (!s) return null;

  const parts = s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
  const nums = parts
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  return nums.length > 0 ? nums : null;
}

function parseLayerCavityIndexParam(
  raw: string | string[] | undefined,
): number | null {
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw.find((s) => s && s.trim()) : raw;
  if (!first) return null;
  const n = Number(String(first).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Build a SearchParams-like object from the browser URL (so we can reuse the same parsers).
 */
function readSearchParamsFromWindow(): SearchParams | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const out: SearchParams = {};
    url.searchParams.forEach((value, key) => {
      const prev = out[key];
      if (typeof prev === "undefined") {
        out[key] = value;
      } else if (Array.isArray(prev)) {
        out[key] = [...prev, value];
      } else {
        out[key] = [prev, value];
      }
    });
    return out;
  } catch {
    return null;
  }
}

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
function parseCavityDims(raw: string): { L: number; W: number; D: number } | null {
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
export default function LayoutPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const router = useRouter();

  /* ---------- Quote number ---------- */

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
        url.searchParams.get("quote_no") ||
        url.searchParams.get("quote") ||
        "";
      if (q && q !== quoteNoFromUrl) setQuoteNoFromUrl(q);
    } catch {
      /* ignore */
    }
  }, []);

  const hasRealQuoteNo =
    !!quoteNoFromUrl && quoteNoFromUrl.trim().length > 0;

  const quoteNo = hasRealQuoteNo
    ? quoteNoFromUrl.trim()
    : "Q-AI-EXAMPLE";

  /* ---------- URL params (dims, cavities, layers) ---------- */

  const hasDimsFromUrl =
    typeof searchParams?.dims !== "undefined" ||
    typeof searchParams?.block !== "undefined";

  const hasCavitiesFromUrl =
    typeof searchParams?.cavities !== "undefined" ||
    typeof searchParams?.cavity !== "undefined";

  const serverBlockStr = normalizeDimsParam(
    (searchParams?.dims ?? searchParams?.block) as
      | string
      | string[]
      | undefined,
  );

  const serverCavityStr = normalizeCavitiesParam(
    (searchParams?.cavities ?? searchParams?.cavity) as
      | string
      | string[]
      | undefined,
  );

  const hasExplicitCavities =
    hasCavitiesFromUrl && serverCavityStr.length > 0;

  /* ---------- Layer intent (from URL / email) ---------- */

  const serverLayerCount = parseLayerCountParam(
    searchParams?.layer_count,
  );

  const serverLayerThicknesses = parseLayerThicknessesParam(
    searchParams?.layer_thicknesses,
  );

  const serverLayerCavityIndex = parseLayerCavityIndexParam(
    searchParams?.layer_cavity_layer_index,
  );

  const serverLayersInfo =
    readLayersFromSearchParams(searchParams) ??
    (serverLayerThicknesses
      ? {
          thicknesses: serverLayerThicknesses,
          labels: serverLayerThicknesses.map(
            (_, i) => `Layer ${i + 1}`,
          ),
        }
      : null);

  /* ---------- Material override ---------- */

  const [materialIdFromUrl, setMaterialIdFromUrl] =
    React.useState<number | null>(() => {
      const raw = searchParams?.material_id as
        | string
        | string[]
        | undefined;
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
      setMaterialIdFromUrl((prev) =>
        prev === parsed ? prev : parsed,
      );
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------- Initial state ---------- */

  const [initialLayout, setInitialLayout] =
    React.useState<LayoutModel | null>(null);

  const [initialNotes, setInitialNotes] =
    React.useState<string>("");

  const [initialQty, setInitialQty] =
    React.useState<number | null>(null);

  const [initialMaterialId, setInitialMaterialId] =
    React.useState<number | null>(null);

  const [initialCustomerName, setInitialCustomerName] =
    React.useState<string>("");

  const [initialCustomerEmail, setInitialCustomerEmail] =
    React.useState<string>("");

  const [initialCustomerCompany, setInitialCustomerCompany] =
    React.useState<string>("");

  const [initialCustomerPhone, setInitialCustomerPhone] =
    React.useState<string>("");

  const [loadingLayout, setLoadingLayout] =
    React.useState<boolean>(true);

  /* ---------- Load layout ---------- */

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // If we have layer info from the URL/email, build a layered layout
        if (serverLayersInfo && serverLayersInfo.thicknesses.length > 0) {
          const fallback = buildLayeredFallbackLayout(
            serverBlockStr,
            serverCavityStr,
            serverLayersInfo.thicknesses,
            serverLayersInfo.labels,
          );

          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(null);
            setInitialMaterialId(materialIdFromUrl ?? null);
            setInitialCustomerName("");
            setInitialCustomerEmail("");
            setInitialCustomerCompany("");
            setInitialCustomerPhone("");
            setLoadingLayout(false);
          }
          return;
        }

        // Otherwise: single-layer fallback
        const fallback = buildLayeredFallbackLayout(
          serverBlockStr,
          serverCavityStr,
          [parseDimsTriple(serverBlockStr)?.H ?? 2],
          ["Layer 1"],
        );

        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(null);
          setInitialMaterialId(materialIdFromUrl ?? null);
          setInitialCustomerName("");
          setInitialCustomerEmail("");
          setInitialCustomerCompany("");
          setInitialCustomerPhone("");
          setLoadingLayout(false);
        }
      } catch (err) {
        console.error("Error loading layout for /quote/layout:", err);
        if (!cancelled) {
          setLoadingLayout(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- Loading guard ---------- */

  if (loadingLayout || !initialLayout) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/80 px-4 py-3 text-sm text-slate-200">
          Loading layout…
        </div>
      </main>
    );
  }

  /* ---------- Main editor host ---------- */

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



function Metric(props: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  const { label, children, sub } = props;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/85 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-50">
        {children}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
      ) : null}
    </div>
  );
}




/* ---------- Layout editor host (main body) ---------- */

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
  } = useLayoutModel(initialLayout);

  const { block, cavities, stack } = layout as LayoutModel & {
    stack?: {
      id: string;
      label: string;
      cavities: any[];
      thicknessIn?: number;
    }[];
  };

  const blockThicknessIn = Number(block.thicknessIn) || 0;

  // "layers" is the normalized view the UI uses everywhere
  const layers = stack && stack.length > 0 ? stack : null;

  // Active layer object
  const activeLayer =
    layers && layers.length > 0
      ? layers.find((layer) => layer.id === activeLayerId) ?? layers[0]
      : null;

  const activeLayerLabel = activeLayer?.label ?? null;

  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  // Thickness source of truth:
  // - layout.stack[].thicknessIn when present
  // - legacy fallback: block.thicknessIn
  const [thicknessTick, setThicknessTick] = React.useState(0);

  const getLayerThickness = React.useCallback(
    (layerId: string): number => {
      const layer =
        layers && layers.length > 0
          ? layers.find((l) => l.id === layerId) ?? null
          : null;

      const raw = layer ? Number(layer.thicknessIn) : NaN;
      if (Number.isFinite(raw) && raw > 0) return raw;

      return blockThicknessIn;
    },
    [layers, blockThicknessIn, thicknessTick],
  );

  const setLayerThicknessIn = React.useCallback(
    (layerId: string, nextThicknessIn: number) => {
      if (!layers || layers.length === 0) return;

      const layer = layers.find((l) => l.id === layerId);
      if (!layer) return;

      const snapped = snapInches(nextThicknessIn);
      if (!Number.isFinite(snapped) || snapped <= 0) return;

      layer.thicknessIn = snapped;

      // Force re-render so the list + totals update
      setThicknessTick((t) => t + 1);

      // Legacy sync: if only one layer, keep block thickness aligned
      if (layers.length === 1) {
        updateBlockDims({ thicknessIn: snapped });
      }
    },
    [layers, updateBlockDims],
  );

  // Seed missing per-layer thickness from block thickness (safe one-time behavior)
  React.useEffect(() => {
    if (!layers || layers.length === 0) return;

    let changed = false;

    for (const layer of layers) {
      const raw = Number(layer.thicknessIn);
      if (!Number.isFinite(raw) || raw <= 0) {
        layer.thicknessIn = blockThicknessIn;
        changed = true;
      }
    }

    if (changed) {
      setThicknessTick((t) => t + 1);
    }
  }, [layers, blockThicknessIn]);

  const effectiveActiveLayerId =
    layers && layers.length > 0 ? activeLayerId ?? layers[0].id : null;

  // Total stack thickness for box/carton suggestions & header labels
  let totalStackThicknessIn = blockThicknessIn;

  if (layers && layers.length >= 1) {
    const sum = layers.reduce((acc, layer) => {
      const raw = Number(layer.thicknessIn);
      const t = Number.isFinite(raw) && raw > 0 ? raw : blockThicknessIn;
      return acc + t;
    }, 0);

    if (sum > 0) totalStackThicknessIn = sum;
  }

  // Ensure the hook has an active layer when stack exists
  React.useEffect(() => {
    if (layers && layers.length > 0 && !activeLayerId) {
      setActiveLayerId(layers[0].id);
    }
  }, [layers, activeLayerId, setActiveLayerId]);

  // Clear selection when switching layers
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

            xIn = clamp(
              xIn,
              Math.min(minXIn, maxXIn),
              Math.max(minXIn, maxXIn),
            );
            yIn = clamp(
              yIn,
              Math.min(minYIn, maxYIn),
              Math.max(minYIn, maxYIn),
            );

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

          xIn = clamp(
            xIn,
            Math.min(minXIn, maxXIn),
            Math.max(minXIn, maxXIn),
          );
          yIn = clamp(
            yIn,
            Math.min(minYIn, maxYIn),
            Math.max(minYIn, maxYIn),
          );

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

  // Handle edits to the active layer's thickness (top row input)
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
        typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : 1;

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

        console.log("[layout] /api/boxes/add-to-quote response", res.status, data);

        if (!res.ok) {
          console.error("Failed to add box to quote", res.status, data);
        }
      } catch (err) {
        console.error("Error in handlePickCarton /api/boxes/add-to-quote", err);
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
  }>({
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
      length: selectedCavity.lengthIn != null ? String(selectedCavity.lengthIn) : "",
      width: selectedCavity.widthIn != null ? String(selectedCavity.widthIn) : "",
      depth: selectedCavity.depthIn != null ? String(selectedCavity.depthIn) : "",
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
      if (selectedCavity.shape === "circle" && (field === "length" || field === "width")) {
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
        updateCavityDims(selectedCavity.id, { cornerRadiusIn: snapped });
        setCavityInputs((prev) => ({ ...prev, cornerRadius: String(snapped) }));
      }
    },
    [cavityInputs, selectedCavity, updateCavityDims],
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const res = await fetch("/api/materials", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (!cancelled && Array.isArray(json.materials)) {
          const mapped: MaterialOption[] = json.materials.map((m: any) => ({
            id: m.id,
            name:
              (m.name ?? m.material_name ?? `Material #${m.id}`) || `Material #${m.id}`,
            family: m.material_family || "Uncategorized",
            density_lb_ft3:
              typeof m.density_lb_ft3 === "number"
                ? m.density_lb_ft3
                : m.density_lb_ft3 != null
                ? Number(m.density_lb_ft3)
                : null,
          }));
          setMaterials(mapped);
        }
      } catch (err) {
        console.error("Error loading materials for layout editor", err);
        if (!cancelled) {
          setMaterialsError("Couldn’t load material list. You can still edit the layout.");
        }
      } finally {
        if (!cancelled) setMaterialsLoading(false);
      }
    }

    loadMaterials();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Safe Family Grouping (no PE/EPE remap) ----
  const materialsByFamily = React.useMemo(() => {
    const map = new Map<string, MaterialOption[]>();

    for (const m of materials) {
      const safeName =
        (m.name && m.name.trim().length > 0 ? m.name : `Material #${m.id}`) ||
        `Material #${m.id}`;
      const key = m.family || "Other";

      const entry: MaterialOption = { ...m, name: safeName };

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }

    for (const [, list] of map) {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    return Array.from(map.entries());
  }, [materials]);

  const missingCustomerInfo = !customerName.trim() || !customerEmail.trim();

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
      alert("This layout isn’t linked to a quote.\nOpen from a real quote email.");
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

        materialLabel = densityLabel ? `${familyLabel}, ${densityLabel}` : familyLabel || null;
      }

      const svg = buildSvgFromLayout(layout, {
        notes: notes && notes.trim().length > 0 ? notes.trim() : undefined,
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
          selectedCartonKind === "RSC" ? boxSuggest.bestRsc : boxSuggest.bestMailer;

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
      if (layers && layers.length > 0) {
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
        window.location.href = "/quote?quote_no=" + encodeURIComponent(quoteNo);
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
  const fmtIn = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    return String(n);
  };

  const activeThickness =
    activeLayer && stack && stack.length > 0
      ? getLayerThickness(activeLayer.id)
      : blockThicknessIn;

  // Derived sizes
  const outsideLengthIn = snapInches((Number(block.lengthIn) || 0) + 2 * WALL_IN);
  const outsideWidthIn = snapInches((Number(block.widthIn) || 0) + 2 * WALL_IN);
  const outsideHeightIn = snapInches(Number(totalStackThicknessIn) || 0);

  const cavityCount = cavities.length;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* ---------- HEADER ---------- */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Layout Editor</div>
            <div className="text-lg font-semibold">{quoteNo}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-sm"
              onClick={() =>
                router.push(`/quote?quote_no=${encodeURIComponent(quoteNo)}`)
              }
            >
              Back to Quote
            </button>

            <button
              className={`px-3 py-2 rounded-lg border text-sm ${
                applyStatus === "done"
                  ? "border-emerald-500 bg-emerald-500/20"
                  : applyStatus === "error"
                  ? "border-rose-500 bg-rose-500/20"
                  : "border-sky-500 bg-sky-500/20"
              }`}
              onClick={handleApplyToQuote}
              disabled={applyStatus === "saving"}
            >
              {applyStatus === "saving"
                ? "Applying…"
                : applyStatus === "done"
                ? "Applied ✓"
                : applyStatus === "error"
                ? "Error — Retry"
                : "Apply to Quote"}
            </button>
          </div>
        </div>

        {/* ---------- METRICS ROW ---------- */}
        <div className="max-w-[1400px] mx-auto px-5 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Metric label="Block">
              {fmtIn(block.lengthIn)}×{fmtIn(block.widthIn)}×
              {fmtIn(block.thicknessIn)} in
            </Metric>

            <Metric label="Outside">
              {fmtIn(outsideLengthIn)}×{fmtIn(outsideWidthIn)}×
              {fmtIn(outsideHeightIn)} in
            </Metric>

            <Metric label="Layers">
              {layers && layers.length > 0 ? layers.length : 1}
            </Metric>

            <Metric label="Active Layer">
              {activeLayerLabel || "—"}
            </Metric>

            <Metric label="Active Thickness">
              {fmtIn(activeThickness)} in
            </Metric>

            <Metric label="Cavities">
              {cavityCount}
            </Metric>
          </div>
         </div>
      </header>

      {/* ---------- BODY (3 COLUMNS) ---------- */}
      <div className="max-w-[1400px] mx-auto p-5">
        <div className="flex flex-row gap-5 min-h-[620px]">
          {/* LEFT / CENTER / RIGHT are in next chunks */}
          {/* LEFT: palette + material + cartons + notes */}
          <aside className="w-52 shrink-0 flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-100 mb-1">
                Cavity palette
              </div>
              <p className="text-[11px] text-slate-400 mb-2">
                Click a style to add a new pocket, then drag and resize it in the
                block.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleAddPreset("rect")}
              className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
            >
              <div className="font-semibold text-slate-50 flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-slate-400/70 bg-slate-900/80" />
                Rectangle
              </div>
              <div className="text-[11px] text-slate-400">
                Rectangular pocket (4&quot; × 2&quot;)
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleAddPreset("circle")}
              className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
            >
              <div className="font-semibold text-slate-50 flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400/70 bg-slate-900/80" />
                Circle
              </div>
              <div className="text-[11px] text-slate-400">
                Round pocket (3&quot; Ø)
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleAddPreset("roundedRect")}
              className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
            >
              <div className="font-semibold text-slate-50 flex items-center gap-2">
                <span className="inline-flex h-4 w-6 items-center justify-center rounded-[4px] border border-slate-400/70 bg-slate-900/80" />
                Rounded rectangle
              </div>
              <div className="text-[11px] text-slate-400">
                Rounded corners (4&quot; × 3&quot;, 0.5&quot; R)
              </div>
            </button>

            {/* Foam material */}
            <div className="mt-2">
              <div className="text-xs font-semibold text-slate-100 mb-1">
                Foam material
              </div>
              <div className="text-[11px] text-slate-400 mb-2">
                Choose the foam family and grade used for this layout.
              </div>

              <select
                value={selectedMaterialId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    setSelectedMaterialId(null);
                  } else {
                    const parsed = Number(v);
                    if (Number.isFinite(parsed)) {
                      setSelectedMaterialId(parsed);
                    }
                  }
                }}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
              >
                <option value="">
                  {materialsLoading
                    ? "Loading materials…"
                    : "Select material (optional)"}
                </option>
                {materialsByFamily.map(([family, list]) => (
                  <optgroup key={family} label={family}>
                    {list.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.density_lb_ft3 != null
                          ? ` · ${m.density_lb_ft3.toFixed(1)} lb/ft³`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {materialsError && (
                <div className="mt-1 text-[11px] text-amber-300">
                  {materialsError}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="mt-2 bg-slate-900/80 rounded-2xl border border-slate-700 p-3">
              <div className="text-xs font-semibold text-slate-100 mb-1">
                Notes / special instructions
              </div>
              <div className="text-[11px] text-slate-400 mb-2">
                Optional text for anything the foam layout needs to call out.
                Saved when you apply.
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 resize-vertical"
              />
            </div>

            {!hasRealQuoteNo && (
              <div className="mt-2 rounded-xl border border-amber-500/70 bg-amber-900/50 px-3 py-2 text-[11px] text-amber-50">
                No quote is linked yet. Open this page from an emailed quote or
                the /quote print view to save layouts back to a real quote.
              </div>
            )}
          </aside>

          {/* CENTER: Big visualizer */}
          <section className="flex-1 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-50">
                  <span className="font-semibold">Foam layout preview</span>
                  <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/60 text-sky-100 text-[11px] font-medium">
                    Interactive layout
                  </span>
                </div>
                {!hasRealQuoteNo && (
                  <div className="text-[11px] text-amber-300 mt-1">
                    Demo only – link from a real quote email to apply layouts.
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-[11px] text-slate-300">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min={0.7}
                    max={1.4}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-32 accent-sky-400"
                  />
                  <span className="text-sky-200 font-mono">
                    {Math.round(zoom * 100)}%
                  </span>
                </label>

                <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={croppedCorners}
                    onChange={(e) => setCroppedCorners(e.target.checked)}
                    className="h-3 w-3 rounded border-slate-600 bg-slate-950"
                  />
                  <span>Crop corners 1&quot;</span>
                </label>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-snug">
              Drag cavities to adjust placement. Use the square handle at the
              bottom-right of each cavity to resize. Cavities are placed inside a
              0.5&quot; wall on all sides.
            </p>

            {/* canvas wrapper */}
            <div className="relative flex-1 rounded-2xl border border-slate-800/90 bg-slate-950 overflow-hidden shadow-[0_22px_55px_rgba(15,23,42,0.95)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-80 bg-[radial-gradient(circle_at_center,_rgba(15,23,42,0.96),transparent_56%),linear-gradient(to_right,rgba(30,64,175,0.3)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,64,175,0.3)_1px,transparent_1px)] [background-size:560px_560px,24px_24px,24px_24px]"
              />
              <div className="relative p-4 overflow-auto">
                <InteractiveCanvas
                  layout={layout}
                  selectedId={selectedId}
                  selectAction={selectCavity}
                  moveAction={(id, xNorm, yNorm) => {
                    selectCavity(id);
                    updateCavityPosition(id, xNorm, yNorm);
                  }}
                  resizeAction={(id, lengthIn, widthIn) =>
                    updateCavityDims(id, { lengthIn, widthIn })
                  }
                  zoom={zoom}
                  croppedCorners={croppedCorners}
                />
              </div>
            </div>
          </section>
          {/* RIGHT: Customer info + cavities list */}
          <aside className="w-72 min-w-[260px] shrink-0 flex flex-col gap-3">
            {/* Customer info card */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold text-slate-100">
                  Customer info
                </div>
                <span
                  className={
                    "inline-flex h-1.5 w-1.5 rounded-full " +
                    (missingCustomerInfo && hasRealQuoteNo
                      ? "bg-rose-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]"
                      : "bg-emerald-400/70 shadow-[0_0_7px_rgba(52,211,153,0.85)]")
                  }
                />
              </div>

              <div className="text-[11px] text-slate-400 mb-2">
                Add who this foam layout is for.{" "}
                <span className="text-sky-300">
                  Name + email are required before applying to the quote.
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-300">
                    Customer name <span className="text-rose-300">*</span>
                  </span>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-300">
                    Company (optional)
                  </span>
                  <input
                    type="text"
                    value={customerCompany}
                    onChange={(e) => setCustomerCompany(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-300">
                    Email <span className="text-rose-300">*</span>
                  </span>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-300">
                    Phone (optional)
                  </span>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                </label>
              </div>

              {missingCustomerInfo && hasRealQuoteNo && (
                <div className="mt-2 text-[11px] text-amber-300">
                  Enter a name and email to enable{" "}
                  <span className="font-semibold">Apply to quote</span>.
                </div>
              )}
            </div>

            {/* Cavities list + editor */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3 flex-1 flex flex-col">
              <div className="text-xs font-semibold text-slate-100">
                Cavities
                {activeLayerLabel && (
                  <span className="ml-1 text-[11px] font-normal text-slate-400">
                    — {activeLayerLabel}
                  </span>
                )}
              </div>

              {cavities.length === 0 ? (
                <div className="mt-2 text-xs text-slate-400">
                  No cavities yet. Use the palette on the left to add a pocket.
                </div>
              ) : (
                <ul className="mt-2 space-y-1.5 mb-3 max-h-40 overflow-auto">
                  {cavities.map((cav, cavIndex) => {
                    const isActive = cav.id === selectedId;

                    const color = CAVITY_COLORS[cavIndex % CAVITY_COLORS.length];
                    const inactiveBg = `${color}33`;
                    const chipStyle = {
                      backgroundColor: isActive ? color : inactiveBg,
                      color: isActive ? "#020617" : "#e5e7eb",
                    } as React.CSSProperties;

                    return (
                      <li
                        key={cav.id}
                        className={`flex items-center justify-between gap-2 rounded-lg px-1 py-1 ${
                          isActive
                            ? "bg-slate-800/80"
                            : "bg-slate-900/40 hover:bg-slate-800/50"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            isActive ? selectCavity(null) : selectCavity(cav.id)
                          }
                          className="flex-1 flex items-center gap-2 text-xs text-left"
                        >
                          <span
                            style={chipStyle}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold"
                          >
                            {cav.id.replace("cav-", "C")}
                          </span>
                          <span
                            className={
                              isActive
                                ? "text-slate-50 font-medium"
                                : "text-slate-200"
                            }
                          >
                            {cav.label}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCavity(cav.id)}
                          className="text-[11px] text-slate-500 hover:text-red-400"
                          title="Delete cavity"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                {selectedCavity ? (
                  <span>
                    Editing{" "}
                    <strong className="text-slate-100">
                      {selectedCavity.label}
                    </strong>
                  </span>
                ) : (
                  <span>Select a cavity above to edit its size and depth.</span>
                )}
              </div>

              {selectedCavity && (
                <>
                  {selectedCavity.shape === "circle" ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">
                          Diameter (in)
                        </span>
                        <input
                          type="number"
                          step={0.125}
                          value={cavityInputs.length}
                          onChange={(e) =>
                            setCavityInputs((prev) => ({
                              ...prev,
                              length: e.target.value,
                            }))
                          }
                          onBlur={() => commitCavityField("length")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCavityField("length");
                            }
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">
                          Depth (in)
                        </span>
                        <input
                          type="number"
                          step={0.125}
                          value={cavityInputs.depth}
                          onChange={(e) =>
                            setCavityInputs((prev) => ({
                              ...prev,
                              depth: e.target.value,
                            }))
                          }
                          onBlur={() => commitCavityField("depth")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCavityField("depth");
                            }
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">
                          Length (in)
                        </span>
                        <input
                          type="number"
                          step={0.125}
                          value={cavityInputs.length}
                          onChange={(e) =>
                            setCavityInputs((prev) => ({
                              ...prev,
                              length: e.target.value,
                            }))
                          }
                          onBlur={() => commitCavityField("length")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCavityField("length");
                            }
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">
                          Width (in)
                        </span>
                        <input
                          type="number"
                          step={0.125}
                          value={cavityInputs.width}
                          onChange={(e) =>
                            setCavityInputs((prev) => ({
                              ...prev,
                              width: e.target.value,
                            }))
                          }
                          onBlur={() => commitCavityField("width")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCavityField("width");
                            }
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">
                          Depth (in)
                        </span>
                        <input
                          type="number"
                          step={0.125}
                          value={cavityInputs.depth}
                          onChange={(e) =>
                            setCavityInputs((prev) => ({
                              ...prev,
                              depth: e.target.value,
                            }))
                          }
                          onBlur={() => commitCavityField("depth")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCavityField("depth");
                            }
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">
                          Corner radius (in)
                        </span>
                        <input
                          type="number"
                          step={0.125}
                          value={cavityInputs.cornerRadius}
                          onChange={(e) =>
                            setCavityInputs((prev) => ({
                              ...prev,
                              cornerRadius: e.target.value,
                            }))
                          }
                          onBlur={() => commitCavityField("cornerRadius")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCavityField("cornerRadius");
                            }
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                        />
                      </label>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCenterSelectedCavity}
                    className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-1 text-[11px] font-medium text-slate-100 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10 transition"
                  >
                    Center this cavity in block
                  </button>
                </>
              )}
            </div>
          </aside>
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
      )}" font-size="${fontSize}" fill="#111827">${escapeText(line)}</text>`;
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
        )}" font-size="10" fill="#111827">${escapeText(line)}</text>`;
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
