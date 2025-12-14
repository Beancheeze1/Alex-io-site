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

// Suggested box types for the box suggester panel
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

export default function LayoutPage({ searchParams }: { searchParams?: SearchParams }) {
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
      const q = url.searchParams.get("quote_no") || url.searchParams.get("quote") || "";
      if (q && q !== quoteNoFromUrl) setQuoteNoFromUrl(q);
    } catch {}
  }, []);

  /* ---------- Other URL params (dims, cavities) ---------- */

  const hasDimsFromUrl =
    typeof searchParams?.dims !== "undefined" || typeof searchParams?.block !== "undefined";

  const hasCavitiesFromUrl =
    typeof searchParams?.cavities !== "undefined" || typeof searchParams?.cavity !== "undefined";

  const serverBlockStr = normalizeDimsParam(
    (searchParams?.dims ?? searchParams?.block) as string | string[] | undefined,
  );

  const serverCavityStr = normalizeCavitiesParam(
    (searchParams?.cavities ?? searchParams?.cavity) as string | string[] | undefined,
  );

  const hasExplicitCavities = hasCavitiesFromUrl && serverCavityStr.length > 0;

  const hasRealQuoteNo = !!quoteNoFromUrl && quoteNoFromUrl.trim().length > 0;

  const quoteNo = hasRealQuoteNo ? quoteNoFromUrl.trim() : "Q-AI-EXAMPLE";

  const [materialIdFromUrl, setMaterialIdFromUrl] = React.useState<number | null>(() => {
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

  const [initialLayout, setInitialLayout] = React.useState<LayoutModel | null>(null);
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(null);
  const [initialMaterialId, setInitialMaterialId] = React.useState<number | null>(null);

  const [initialCustomerName, setInitialCustomerName] = React.useState<string>("");
  const [initialCustomerEmail, setInitialCustomerEmail] = React.useState<string>("");
  const [initialCustomerCompany, setInitialCustomerCompany] = React.useState<string>("");
  const [initialCustomerPhone, setInitialCustomerPhone] = React.useState<string>("");

  const [loadingLayout, setLoadingLayout] = React.useState<boolean>(true);

  /**
   * Fallback layout builder, driven by arbitrary dims/cavities strings.
   * (Preserves your original cavity parsing/auto-placement behavior.)
   */
  const buildFallbackLayout = React.useCallback(
    (blockStr: string, cavityStr: string): LayoutModel => {
      const parsedBlock = parseDimsTriple(blockStr) ?? { L: 10, W: 10, H: 2 };

      const block = {
        lengthIn: parsedBlock.L,
        widthIn: parsedBlock.W,
        thicknessIn: parsedBlock.H,
      };

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

      return { block, cavities };
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
          const cavitiesParams = url.searchParams.getAll("cavities").filter((v) => v);
          const cavityParams = url.searchParams.getAll("cavity").filter((v) => v);

          cavityParts.push(...cavitiesParams, ...cavityParams);

          if (dimsCandidates.length > 0) {
            effectiveBlockStr = normalizeDimsParam(dimsCandidates[0]);
          }

          if (cavityParts.length > 0) {
            effectiveCavityStr = normalizeCavitiesParam(cavityParts);
          }
        }
      } catch {
        // fall back to serverBlockStr/serverCavityStr
      }

      try {
        // If we don't have a real quote number, just use fallback layout
        if (!hasRealQuoteNo) {
          const fallback = buildFallbackLayout(effectiveBlockStr, effectiveCavityStr);
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

        // Try to fetch the latest layout package via /api/quote/print
        const res = await fetch(
          "/api/quote/print?quote_no=" + encodeURIComponent(quoteNoFromUrl.trim()),
          { cache: "no-store" },
        );

        if (!res.ok) {
          const fallback = buildFallbackLayout(effectiveBlockStr, effectiveCavityStr);
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

        // Pull qty + material from primary line item (if present)
        let qtyFromItems: number | null = null;
        let materialIdFromItems: number | null = null;
        if (Array.isArray(json.items) && json.items.length > 0) {
          const first = json.items[0];
          const rawQty = Number(first?.qty);
          if (Number.isFinite(rawQty) && rawQty > 0) qtyFromItems = rawQty;

          const mid = Number(first?.material_id);
          if (Number.isFinite(mid) && mid > 0) materialIdFromItems = mid;
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
            setInitialCustomerCompany("");
            setInitialCustomerPhone((qh.phone ?? "").toString());
          }
        } else if (!cancelled) {
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
          const layoutFromDb = json.layoutPkg.layout_json as LayoutModel;
          const notesFromDb = (json.layoutPkg.notes as string | null) ?? "";

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
        const fallback = buildFallbackLayout(effectiveBlockStr, effectiveCavityStr);
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(qtyFromItems);
          setInitialMaterialId(materialIdOverride ?? materialIdFromItems);
          setLoadingLayout(false);
        }
      } catch (err) {
        console.error("Error loading layout for /quote/layout:", err);
        const fallback = buildFallbackLayout(effectiveBlockStr, effectiveCavityStr);
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

const CAVITY_COLORS = ["#38bdf8", "#a855f7", "#f97316", "#22c55e", "#eab308", "#ec4899"];

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
    deleteLayer,
  } = useLayoutModel(initialLayout);

  const { block, cavities, stack } = layout as LayoutModel & {
    stack?: { id: string; label: string; cavities: any[]; thicknessIn?: number }[];
  };

  const blockThicknessIn = Number(block.thicknessIn) || 0;

  // Force re-render when we mutate stack thickness (Path A: no hook changes)
  const [, bump] = React.useState(0);

  // Truth: layout.stack[].thicknessIn (fallback to block thickness if missing)
  const getLayerThickness = React.useCallback(
    (layerId: string): number => {
      const layer = stack?.find((l) => l.id === layerId);
      const raw = layer?.thicknessIn;
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
      return blockThicknessIn;
    },
    [stack, blockThicknessIn],
  );

  const setLayerThicknessInModel = React.useCallback(
    (layerId: string, thickness: number) => {
      if (!stack || stack.length === 0) return;
      const snapped = snapInches(thickness);
      const idx = stack.findIndex((l) => l.id === layerId);
      if (idx < 0) return;

      // mutate in-place (then bump) to avoid hook refactors
      const cur = stack[idx];
      cur.thicknessIn = snapped;

      // single-layer: keep block thickness in sync
      if (stack.length === 1 && stack[0].id === layerId) {
        updateBlockDims({ thicknessIn: snapped });
      }

      bump((n) => n + 1);
    },
    [stack, updateBlockDims],
  );

  // Seed missing thicknessIn once whenever layers exist
  React.useEffect(() => {
    if (!stack || stack.length === 0) return;
    let changed = false;
    for (const layer of stack) {
      if (!(typeof layer.thicknessIn === "number" && Number.isFinite(layer.thicknessIn) && layer.thicknessIn > 0)) {
        layer.thicknessIn = blockThicknessIn || 1;
        changed = true;
      }
    }
    if (changed) bump((n) => n + 1);
  }, [stack, blockThicknessIn]);

  const activeLayer =
    stack && stack.length > 0
      ? stack.find((layer) => layer.id === activeLayerId) ?? stack[0]
      : null;

  const activeLayerLabel = activeLayer?.label ?? null;
  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  const layers = stack && stack.length > 0 ? stack : null;

  const effectiveActiveLayerId = layers && layers.length > 0 ? activeLayerId ?? layers[0].id : null;

  // Total stack thickness used for box/carton suggestions.
  let totalStackThicknessIn = blockThicknessIn;
  if (stack && stack.length > 1) {
    const sum = stack.reduce((acc, layer) => acc + (getLayerThickness(layer.id) || 0), 0);
    if (sum > 0) totalStackThicknessIn = sum;
  } else if (stack && stack.length === 1) {
    totalStackThicknessIn = getLayerThickness(stack[0].id) || blockThicknessIn;
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

  // Handle edits to the active layer's thickness
  const handleActiveLayerThicknessChange = (value: string) => {
    if (!activeLayer) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setLayerThicknessInModel(activeLayer.id, num);
  };

  const [zoom, setZoom] = React.useState(1);
  const [croppedCorners, setCroppedCorners] = React.useState(false);
  const [notes, setNotes] = React.useState(initialNotes || "");
  const [applyStatus, setApplyStatus] = React.useState<"idle" | "saving" | "done" | "error">("idle");
  const [qty, setQty] = React.useState<number | "">(initialQty != null ? initialQty : "");
  // Customer info
  const [customerName, setCustomerName] = React.useState<string>(initialCustomerName || "");
  const [customerEmail, setCustomerEmail] = React.useState<string>(initialCustomerEmail || "");
  const [customerCompany, setCustomerCompany] = React.useState<string>(initialCustomerCompany || "");
  const [customerPhone, setCustomerPhone] = React.useState<string>(initialCustomerPhone || "");

  const [materials, setMaterials] = React.useState<MaterialOption[]>([]);
  const [materialsLoading, setMaterialsLoading] = React.useState<boolean>(true);
  const [materialsError, setMaterialsError] = React.useState<string | null>(null);
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

  // FIXED: shared carton button classes (no truncation)
  const cartonButtonBase =
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition";
  const cartonButtonIdle =
    "border-slate-600 bg-slate-900/80 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10";
  const cartonButtonActive =
    "border-sky-400 bg-sky-500/20 text-sky-50";

  const handlePickCarton = React.useCallback(
    async (kind: "RSC" | "MAILER") => {
      setSelectedCartonKind(kind);

      const sku =
        kind === "RSC" ? boxSuggest.bestRsc?.sku : boxSuggest.bestMailer?.sku;

      if (!quoteNo || !sku) return;

      const numericQty =
        typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : 1;

      try {
        await fetch("/api/boxes/add-to-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no: quoteNo,
            sku,
            qty: numericQty,
          }),
        });
      } catch (err) {
        console.error("handlePickCarton failed", err);
      }
    },
    [boxSuggest.bestRsc, boxSuggest.bestMailer, quoteNo, qty],
  );

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

  /* ---------- Apply-to-Quote ---------- */

  const handleApplyToQuote = async () => {
    if (!hasRealQuoteNo || missingCustomerInfo) return;

    try {
      setApplyStatus("saving");

      const payload: any = {
        quoteNo,
        layout,
        notes,
        customer: {
          name: customerName.trim(),
          email: customerEmail.trim(),
          company: customerCompany.trim() || null,
          phone: customerPhone.trim() || null,
        },
      };

      if (layers && layers.length > 0) {
        payload.foamLayers = layers.map((layer) => ({
          id: layer.id,
          label: layer.label,
          thicknessIn: getLayerThickness(layer.id),
        }));
      }

      const nQty = Number(qty);
      if (Number.isFinite(nQty) && nQty > 0) payload.qty = nQty;
      if (selectedMaterialId != null) payload.materialId = selectedMaterialId;

      await fetch("/api/quote/layout/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (typeof window !== "undefined") {
        window.location.href = "/quote?quote_no=" + encodeURIComponent(quoteNo);
      }
    } catch (err) {
      console.error("Apply-to-quote failed", err);
      setApplyStatus("error");
      setTimeout(() => setApplyStatus("idle"), 3000);
    }
  };
  /* ---------- Materials ---------- */

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
              (m.name ?? m.material_name ?? `Material #${m.id}`) ||
              `Material #${m.id}`,
            family: m.material_family || "Other",
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
          setMaterialsError("Couldn’t load material list.");
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

  // ---- Safe family grouping (NO PE/EPE remap) ----
  const materialsByFamily = React.useMemo(() => {
    const map = new Map<string, MaterialOption[]>();

    for (const m of materials) {
      const family = m.family || "Other";
      if (!map.has(family)) map.set(family, []);
      map.get(family)!.push(m);
    }

    for (const [, list] of map) {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    return Array.from(map.entries());
  }, [materials]);

  /* ---------- Derived labels ---------- */

  const footprintLabel =
    Number(block.lengthIn) > 0 && Number(block.widthIn) > 0
      ? `${Number(block.lengthIn).toFixed(2)}" × ${Number(
          block.widthIn,
        ).toFixed(2)}"`
      : "—";

  const stackDepthLabel =
    totalStackThicknessIn > 0 ? `${totalStackThicknessIn.toFixed(2)}"` : "—";

  const effectiveQty =
    typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : null;
  const qtyLabel = effectiveQty != null ? effectiveQty.toLocaleString() : "—";

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
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-65 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),transparent_55%),linear-gradient(to_right,rgba(15,23,42,0.95)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.95)_1px,transparent_1px)] [background-size:460px_460px,28px_28px,28px_28px]"
          />
          <div className="relative">
            {/* Header */}
            <div className="border-b border-slate-800/80 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
              <div className="flex items-center gap-4 w-full">
                <div className="flex flex-col">
                  <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-sky-50/90">
                    Powered by Alex-IO
                  </div>
                  <div className="mt-1 text-xs text-sky-50/95">
                    Quote{" "}
                    <span className="font-mono font-semibold text-slate-50">{quoteNo}</span>
                    {hasRealQuoteNo ? (
                      <span className="ml-1 text-sky-100/90">· Linked to active quote</span>
                    ) : (
                      <span className="ml-1 text-amber-50/90">· Demo view (no quote linked)</span>
                    )}
                  </div>
                </div>

                <div className="flex-1 text-center">
                  <div className="inline-flex flex-col items-center gap-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100/70">
                      Foam layout tools
                    </div>
                    <div className="text-2xl md:text-[26px] font-extrabold leading-snug bg-gradient-to-r from-sky-50 via-cyan-200 to-sky-100 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(15,23,42,0.9)]">
                      Interactive foam layout editor
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-sky-50">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.95)]" />
                    Layout editor · BETA
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div className="px-5 pt-3 pb-2 bg-slate-950/95 border-b border-slate-900/80">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* LEFT: Layers summary + quick metrics + block dims */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 text-[11px] text-slate-200">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">
                        Layers
                      </span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-200">
                        <span>
                          {layers && layers.length > 0 ? (
                            <>
                              {layers.length} layer{layers.length > 1 ? "s" : ""} · Active:{" "}
                              <span className="font-semibold text-slate-50">
                                {activeLayerLabel ?? layers[0].label}
                              </span>
                            </>
                          ) : (
                            "Single foam block"
                          )}
                        </span>
                        <span className="text-slate-400">
                          · Footprint <span className="font-mono text-slate-100">{footprintLabel}</span>
                        </span>
                        <span className="text-slate-400">
                          · Stack depth <span className="font-mono text-slate-100">{stackDepthLabel}</span>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addLayer}
                      className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10 transition"
                    >
                      + Layer
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-400">Length (in)</span>
                      <input
                        type="number"
                        step={0.125}
                        value={block.lengthIn}
                        onChange={(e) => updateBlockDims({ lengthIn: snapInches(Number(e.target.value)) })}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-400">Width (in)</span>
                      <input
                        type="number"
                        step={0.125}
                        value={block.widthIn}
                        onChange={(e) => updateBlockDims({ widthIn: snapInches(Number(e.target.value)) })}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-400">Active layer thick (in)</span>
                      <input
                        type="number"
                        step={0.125}
                        value={activeLayer ? getLayerThickness(activeLayer.id) : blockThicknessIn}
                        onChange={(e) => handleActiveLayerThicknessChange(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                  </div>
                </div>

                {/* CENTER: controls */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-400/80" />
                      Layout controls
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Quoted qty: <span className="font-mono text-slate-50">{qtyLabel}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-1">
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
                      <span className="ml-1 text-sky-200 font-mono">{Math.round(zoom * 100)}%</span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Qty</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={qty}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return setQty("");
                          const num = Number(v);
                          if (!Number.isFinite(num) || num <= 0) return;
                          setQty(num);
                        }}
                        disabled={!hasRealQuoteNo}
                        className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={missingCustomerInfo}
                      onClick={() => {
                        if (missingCustomerInfo) return;
                        const params = new URLSearchParams();
                        if (hasRealQuoteNo && quoteNo) params.set("quote_no", quoteNo);
                        const L = Number(block.lengthIn) || 0;
                        const W = Number(block.widthIn) || 0;
                        const T = Number(block.thicknessIn) || 0;
                        if (L > 0 && W > 0 && T >= 0) params.set("block", `${L}x${W}x${T}`);
                        router.push(params.toString() ? `/foam-advisor?${params.toString()}` : "/foam-advisor");
                      }}
                      className="inline-flex flex-1 items-center justify-center rounded-full border border-sky-500/60 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-500/10 hover:border-sky-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Recommend my foam
                    </button>

                    <button
                      type="button"
                      onClick={handleApplyToQuote}
                      disabled={!(hasRealQuoteNo && !missingCustomerInfo && applyStatus !== "saving")}
                      className="inline-flex flex-1 items-center justify-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition disabled:opacity-60"
                    >
                      {applyStatus === "saving"
                        ? "Applying…"
                        : applyStatus === "error"
                        ? "Error – retry"
                        : "Apply to quote"}
                    </button>
                  </div>
                </div>

                {/* RIGHT: Layer details */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 text-[11px] text-slate-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">
                        Layer details
                      </span>
                      <span className="text-xs text-slate-200">
                        Stack depth: <span className="font-mono text-slate-50">{stackDepthLabel}</span>
                      </span>
                    </div>
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

                  {layers && layers.length > 0 ? (
                    <div className="max-h-32 overflow-auto space-y-1 mt-0.5">
                      {layers.map((layer) => {
                        const isActive = activeLayer?.id === layer.id;
                        const layerThick = getLayerThickness(layer.id);

                        return (
                          <div
                            key={layer.id}
                            className={
                              "rounded-lg border px-2.5 py-1 flex items-center justify-between gap-2 " +
                              (isActive
                                ? "border-sky-500/80 bg-sky-500/10"
                                : "border-slate-700 bg-slate-900/80 hover:border-sky-400/70")
                            }
                          >
                            <div className="flex flex-col gap-0.5 flex-1">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveLayerId(layer.id)}
                                  className={"text-xs font-medium " + (isActive ? "text-sky-100" : "text-slate-100")}
                                >
                                  {layer.label}
                                </button>

                                <span className="text-[10px] text-slate-400">· Thickness (in)</span>
                                <input
                                  type="number"
                                  step={0.125}
                                  value={layerThick}
                                  onChange={(e) => {
                                    const num = Number(e.target.value);
                                    if (!Number.isFinite(num) || num <= 0) return;
                                    setLayerThicknessInModel(layer.id, num);
                                  }}
                                  className="w-16 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-100"
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {stack && stack.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => deleteLayer(layer.id)}
                                  className="text-[11px] text-slate-400 hover:text-red-400"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-400">
                      Single-layer foam block. Add layers if this layout needs multiple pads.
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Body: three-column layout */}
            <div className="flex flex-row gap-5 p-5 bg-slate-950/90 text-slate-100 min-h-[620px]">
              {/* LEFT */}
              <aside className="w-52 shrink-0 flex flex-col gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-100 mb-1">Cavity palette</div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Click a style to add a new pocket, then drag and resize it in the block.
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
                  <div className="text-[11px] text-slate-400">Rectangular pocket (4&quot; × 2&quot;)</div>
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
                  <div className="text-[11px] text-slate-400">Round pocket (3&quot; Ø)</div>
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
                  <div className="text-xs font-semibold text-slate-100 mb-1">Foam material</div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Choose the foam family and grade used for this layout.
                  </div>
                  <select
                    value={selectedMaterialId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return setSelectedMaterialId(null);
                      const parsed = Number(v);
                      if (Number.isFinite(parsed)) setSelectedMaterialId(parsed);
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="">
                      {materialsLoading ? "Loading materials…" : "Select material (optional)"}
                    </option>
                    {materialsByFamily.map(([family, list]) => (
                      <optgroup key={family} label={family}>
                        {list.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.density_lb_ft3 != null ? ` · ${m.density_lb_ft3.toFixed(1)} lb/ft³` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {materialsError && <div className="mt-1 text-[11px] text-amber-300">{materialsError}</div>}
                </div>

                {/* Closest matching cartons */}
                <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/85 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold text-slate-100">Closest matching cartons</div>
                    <span className="inline-flex items-center rounded-full bg-slate-800/90 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                      Box suggester · BETA
                    </span>
                  </div>

                  {!suggesterReady ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
                      Waiting for layout &amp; customer info…
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
                            <span className="font-mono text-sky-300 text-[10px]">{boxSuggest.bestRsc.sku}</span>
                          </div>
                          <div className="text-slate-300">{boxSuggest.bestRsc.description}</div>

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handlePickCarton("RSC")}
                              className={[
                                cartonButtonBase,
                                selectedCartonKind === "RSC" ? cartonButtonActive : cartonButtonIdle,
                              ].join(" ")}
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
                            <span className="font-mono text-sky-300 text-[10px]">{boxSuggest.bestMailer.sku}</span>
                          </div>
                          <div className="text-slate-300">{boxSuggest.bestMailer.description}</div>

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handlePickCarton("MAILER")}
                              className={[
                                cartonButtonBase,
                                selectedCartonKind === "MAILER" ? cartonButtonActive : cartonButtonIdle,
                              ].join(" ")}
                            >
                              {selectedCartonKind === "MAILER" ? "Selected carton" : "Pick this box"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="mt-2 bg-slate-900/80 rounded-2xl border border-slate-700 p-3">
                  <div className="text-xs font-semibold text-slate-100 mb-1">Notes / special instructions</div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 resize-vertical"
                  />
                </div>
              </aside>

              {/* CENTER */}
              <section className="flex-1 flex flex-col gap-3">
                <div className="relative flex-1 rounded-2xl border border-slate-800/90 bg-slate-950 overflow-hidden shadow-[0_22px_55px_rgba(15,23,42,0.95)]">
                  <div className="relative p-4 overflow-auto">
                    <InteractiveCanvas
                      layout={layout}
                      selectedId={selectedId}
                      selectAction={selectCavity}
                      moveAction={(id, xNorm, yNorm) => {
                        selectCavity(id);
                        updateCavityPosition(id, xNorm, yNorm);
                      }}
                      resizeAction={(id, lengthIn, widthIn) => updateCavityDims(id, { lengthIn, widthIn })}
                      zoom={zoom}
                      croppedCorners={croppedCorners}
                    />
                  </div>
                </div>
              </section>

              {/* RIGHT */}
              <aside className="w-72 min-w-[260px] shrink-0 flex flex-col gap-3">
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                  <div className="text-xs font-semibold text-slate-100 mb-1">Customer info</div>
                  <div className="space-y-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">Customer name *</span>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">Email *</span>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                  </div>
                </div>

                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3 flex-1">
                  <div className="text-xs font-semibold text-slate-100">Cavities</div>
                  <div className="mt-2 text-xs text-slate-400">
                    ({cavities.length} total in active layer)
                  </div>
                </div>
              </aside>
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
          `  <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(
            2,
          )}" fill="none" stroke="#111827" stroke-width="1" />`,
          `  <text x="${cx.toFixed(2)}" y="${cy.toFixed(
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
          `  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cavW.toFixed(
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
  if (T > 0) headerLines.push(`BLOCK: ${L}" × ${W}" × ${T}"`);
  else headerLines.push(`BLOCK: ${L}" × ${W}" (thickness see quote)`);

  if (meta?.materialLabel) headerLines.push(`MATERIAL: ${meta.materialLabel}`);

  const headerTexts = headerLines
    .map((line, idx) => {
      const y = PADDING + idx * 14;
      const fontSize = idx === 0 ? 11 : 10;
      return `<text x="${PADDING.toFixed(2)}" y="${y.toFixed(
        2,
      )}" font-size="${fontSize}" fill="#111827">${escapeText(line)}</text>`;
    })
    .join("\n    ");

  const headerSection = `<g>
    ${headerTexts}
  </g>`;

  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">`,
  );
  svgParts.push(`  ${headerSection}`);
  svgParts.push(
    `  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(
      2,
    )}" width="${blockW.toFixed(2)}" height="${blockH.toFixed(
      2,
    )}" rx="0" ry="0" fill="#e5e7eb" stroke="#111827" stroke-width="2" />`,
  );
  if (cavRects) svgParts.push(cavRects);
  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}
