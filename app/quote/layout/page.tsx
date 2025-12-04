// app/quote/layout/page.tsx
//
// Layout editor host page (wide).
// - Left: palette + notes
// - Center: large canvas
// - Right: block + cavity inspector + customer info
// - Apply to quote posts layout + notes + SVG to /api/quote/layout/apply
//
// Extras:
// - If opened with a real quote_no, it fetches the latest saved layout
//   from /api/quote/print and uses layout_json + notes as the starting point.
// - If no saved layout exists, it falls back to a layout built from the
//   URL dims/cavities (or just a bare block if we can’t parse cavities).
// - After a successful "Apply to quote", automatically navigates to
//   /quote?quote_no=... so the user sees the updated printable quote.
// - Shows editable Qty in the top-right next to Zoom / Apply,
//   seeded from the primary line item when available.
// - If the URL includes an explicit `cavities=` param, we treat that as fresh
//   and ignore any saved DB layout geometry for the initial load, so
//   email → layout always reflects the latest cavity dims instead of an
//   old 3x2x1 test layout.

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

/**
 * Normalize block dims from searchParams (dims= / block=).
 * - Accepts string or string[]
 * - Uses the first non-empty entry when an array is provided
 * - Falls back to 10x10x2 if nothing usable is present
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
 * Normalize cavity dims from searchParams (cavities= / cavity=).
 * - Accepts string or string[]
 * - When multiple values are present, join them with ";"
 * - De-duplicate identical strings so
 *   "cavities=1x1x1&cavity=1x1x1" → "1x1x1" (one pocket)
 */
function normalizeCavitiesParam(raw: string | string[] | undefined): string {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map((s) => s.trim())
      .filter(Boolean);
    const unique: string[] = [];
    for (const val of cleaned) {
      if (!unique.includes(val)) {
        unique.push(val);
      }
    }
    return unique.join(";");
  }
  return raw.trim();
}

// Ensure all dimension edits snap to 0.125"
const SNAP_IN = 0.125;
const WALL_IN = 0.5;

// Simple parser for "LxWxH" strings
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

// Simple parser for cavity dims; if only LxW, assume depth = 1"
// IMPORTANT: accepts both "0.5" and ".5" style numbers.
function parseCavityDims(raw: string): { L: number; W: number; D: number } | null {
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");

  // allow "1", "1.5", ".5" etc.
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

function snapInches(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / SNAP_IN) * SNAP_IN;
}

export default function LayoutPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  /* ---------- Read quote number (URL → state) ---------- */

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

      if (q && q !== quoteNoFromUrl) {
        setQuoteNoFromUrl(q);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [materialIdFromUrl, setMaterialIdFromUrl] = React.useState<number | null>(
    () => {
      const raw = searchParams?.material_id as string | string[] | undefined;
      if (!raw) return null;
      const first = Array.isArray(raw) ? raw[0] : raw;
      const parsed = Number(first);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Build initial layout (from DB if available) ---------- */

  const [initialLayout, setInitialLayout] = React.useState<LayoutModel | null>(
    null,
  );
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(null);
  const [initialMaterialId, setInitialMaterialId] =
    React.useState<number | null>(null);

  // NEW: customer initial values (prefill from quote header when available)
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
   * We pass in the *effective* strings (from window.location when possible)
   * so we aren't at the mercy of how Next packaged searchParams.
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

        // Pull qty + material from primary line item (if present)
        let qtyFromItems: number | null = null;
        let materialIdFromItems: number | null = null;
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
        }

        // NEW: pull customer info from quote header when present
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
          const layoutFromDb = json.layoutPkg.layout_json as LayoutModel;
          const notesFromDb =
            (json.layoutPkg.notes as string | null) ?? "";

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
    stack?: { id: string; label: string; cavities: any[] }[];
  };

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
  }, [effectiveActiveLayerId, layerCount, selectCavity]);

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

  React.useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const res = await fetch("/api/materials", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();

        if (!cancelled && Array.isArray(json.materials)) {
          const mapped: MaterialOption[] = json.materials.map((m: any) => ({
            id: m.id,
            name:
              (m.name ??
                m.material_name ??
                `Material #${m.id}`) || `Material #${m.id}`,
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
          setMaterialsError(
            "Couldn’t load material list. You can still edit the layout.",
          );
        }
      } finally {
        if (!cancelled) {
          setMaterialsLoading(false);
        }
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
        (m.name && m.name.trim().length > 0
          ? m.name
          : `Material #${m.id}`) || `Material #${m.id}`;
      const key = m.family || "Other";

      const entry: MaterialOption = {
        ...m,
        name: safeName,
      };

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }

    for (const [, list] of map) {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    return Array.from(map.entries());
  }, [materials]);

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
            <div className="border-b border-slate-800/80 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
              <div className="flex items-center gap-4 w-full">
                {/* LEFT: powered by + quote */}
                <div className="flex flex-col">
                  <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-sky-50/90">
                    Powered by Alex-IO
                  </div>
                  <div className="mt-1 text-xs text-sky-50/95">
                    Quote{" "}
                    <span className="font-mono font-semibold text-slate-50">
                      {quoteNo}
                    </span>
                    {hasRealQuoteNo ? (
                      <span className="ml-1 text-sky-100/90">
                        · Linked to active quote
                      </span>
                    ) : (
                      <span className="ml-1 text-amber-50/90">
                        · Demo view (no quote linked)
                      </span>
                    )}
                  </div>
                </div>

                {/* CENTER: stylized title */}
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

                {/* RIGHT: BETA pill */}
                <div className="flex items-center justify-end">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-sky-50">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.95)]" />
                    Layout editor · BETA
                  </span>
                </div>
              </div>
            </div>

            {/* How this works */}
            <div className="border-b border-slate-800/80 bg-slate-950/95 px-6 py-3 text-[11px] text-slate-200 flex flex-wrap items-start gap-4">
              <div className="flex items-center gap-2 font-semibold text-sky-200">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-400/70 bg-sky-500/20 text-[10px] font-bold shadow-[0_0_14px_rgba(56,189,248,0.7)]">
                  ?
                </span>
                How this layout editor works
              </div>

              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                <li>
                  <span className="text-sky-300 mr-1">1.</span>
                  Adjust the foam block, add cavities from the left palette.
                </li>
                <li>
                  <span className="text-sky-300 mr-1">2.</span>
                  Drag / resize in the center canvas to fine-tune placement.
                </li>
                <li>
                  <span className="text-sky-300 mr-1">3.</span>
                  Fill in customer + material, then{" "}
                  <span className="font-semibold text-sky-200">
                    Apply to quote
                  </span>
                  .
                </li>
              </ul>
            </div>

            {/* Body: three-column layout */}
            <div className="flex flex-row gap-5 p-5 bg-slate-950/90 text-slate-100 min-h-[620px]">
              {/* LEFT: Cavity palette + material + notes */}
              <aside className="w-52 shrink-0 flex flex-col gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Cavity palette
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Click a style to add a new pocket, then drag and resize it in
                    the block.
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

                {/* Foam material (in left bar) */}
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
                              ? ` · ${m.density_lb_ft3.toFixed(
                                  1,
                                )} lb/ft³`
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

                {/* Notes / special instructions */}
                <div className="mt-2 bg-slate-900/80 rounded-2xl border border-slate-700 p-3">
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Notes / special instructions
                  </div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Optional text for anything the foam layout needs to call out
                    (loose parts, labels, extra protection, etc.). This will be
                    saved with the quote when you apply.
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 resize-vertical"
                  />
                </div>

                <div className="mt-1 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
                  Cavities snap to 0.125&quot; and keep 0.5&quot; walls to block
                  edges and between pockets.
                </div>

                {!hasRealQuoteNo && (
                  <div className="mt-3 rounded-xl border border-amber-500/70 bg-amber-900/50 px-3 py-2 text-[11px] text-amber-50">
                    No quote is linked yet. Open this page from an emailed quote
                    or the /quote print view to save layouts back to a real
                    quote.
                  </div>
                )}
              </aside>

              {/* CENTER: Big visualizer */}
              <section className="flex-1 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-slate-50">
                      <span className="font-semibold">
                        Foam layout preview
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/60 text-sky-100 text-[11px] font-medium">
                        Interactive layout
                      </span>
                    </div>

                    {/* Layer selector + manager (horizontal style) */}
                    {stack && stack.length > 0 && (
                      <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-300">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">
                              Layers
                            </span>
                            <div className="flex flex-wrap items-center gap-1">
                              {stack.map((layer) => {
                                const isActive = activeLayer?.id === layer.id;
                                return (
                                  <button
                                    key={layer.id}
                                    type="button"
                                    onClick={() =>
                                      setActiveLayerId(layer.id)
                                    }
                                    className={
                                      "px-2 py-0.5 rounded-full border text-[11px] " +
                                      (isActive
                                        ? "bg-sky-500 text-slate-950 border-sky-400"
                                        : "bg-slate-800/80 text-slate-200 border-slate-700 hover:border-sky-400 hover:text-sky-100")
                                    }
                                  >
                                    {layer.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={activeLayerId ?? (stack[0]?.id ?? "")}
                              onChange={(e) =>
                                setActiveLayerId(e.target.value)
                              }
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
                            >
                              {stack.map((layer) => (
                                <option key={layer.id} value={layer.id}>
                                  {layer.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={addLayer}
                              className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10 transition"
                            >
                              + Add layer
                            </button>
                          </div>
                        </div>
                        {activeLayer && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="text"
                              value={activeLayer.label}
                              onChange={(e) =>
                                renameLayer(activeLayer.id, e.target.value)
                              }
                              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-100"
                              placeholder="Layer name"
                            />
                            {stack.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  deleteLayer(activeLayer.id)
                                }
                                className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:text-red-300 hover:border-red-400 transition"
                                title="Delete this layer"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {!hasRealQuoteNo && (
                      <div className="text-[11px] text-amber-300 mt-1">
                        Demo only – link from a real quote email to apply
                        layouts.
                      </div>
                    )}
                  </div>

                  {/* zoom + crop corners + qty + advisor + apply button */}
                  <div className="flex items-center gap-3">
                    <div className="hidden md:flex items-center text-[11px] text-slate-400 mr-1">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-400/80 mr-1.5" />
                      <span>Layout controls</span>
                    </div>
                    <div className="inline-flex items-center gap-3 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 shadow-[0_0_16px_rgba(15,23,42,0.8)]">
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <span>Zoom</span>
                        <input
                          type="range"
                          min={0.7}
                          max={1.4}
                          step={0.05}
                          value={zoom}
                          onChange={(e) => setZoom(Number(e.target.value))}
                          className="w-28 accent-sky-400"
                        />
                        <span className="ml-1 text-sky-200 font-mono">
                          {Math.round(zoom * 100)}%
                        </span>
                      </div>

                      <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={croppedCorners}
                          onChange={(e) => setCroppedCorners(e.target.checked)}
                          className="h-3 w-3 rounded border-slate-600 bg-slate-900 text-sky-400"
                        />
                        <span>Crop corners 1&quot;</span>
                      </label>

                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <span>Qty</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={qty}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) {
                              setQty("");
                              return;
                            }
                            const num = Number(v);
                            if (!Number.isFinite(num) || num <= 0) return;
                            setQty(num);
                          }}
                          disabled={!hasRealQuoteNo}
                          className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleGoToFoamAdvisor}
                        disabled={missingCustomerInfo}
                        className="inline-flex items-center rounded-full border border-sky-500/60 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-500/10 hover:border-sky-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Recommend my foam
                      </button>

                      <button
                        type="button"
                        onClick={handleApplyToQuote}
                        disabled={!canApplyButton}
                        className="inline-flex items-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition disabled:opacity-60"
                      >
                        {!hasRealQuoteNo
                          ? "Link to a quote first"
                          : missingCustomerInfo
                          ? "Add name + email"
                          : applyStatus === "saving"
                          ? "Applying…"
                          : applyStatus === "done"
                          ? "Applied!"
                          : applyStatus === "error"
                          ? "Error – retry"
                          : "Apply to quote"}
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 leading-snug">
                  Drag cavities to adjust placement. Use the square handle at the
                  bottom-right of each cavity to resize. Cavities are placed
                  inside a 0.5&quot; wall on all sides. When a cavity is
                  selected, the nearest horizontal and vertical gaps to other
                  cavities and to the block edges are dimensioned.
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
                      moveAction={updateCavityPosition}
                      resizeAction={(id, lengthIn, widthIn) =>
                        updateCavityDims(id, { lengthIn, widthIn })
                      }
                      zoom={zoom}
                      croppedCorners={croppedCorners}
                    />
                  </div>
                </div>
              </section>

              {/* RIGHT: Inspector + customer info */}
              <aside className="w-72 min-w-[260px] shrink-0 flex flex-col gap-3">
                {/* Block editor */}
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold text-slate-100">
                      Block
                    </div>
                    <span className="inline-flex items-center rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                      Foam blank
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Edit the foam blank size. Values snap to 0.125&quot;
                    increments.
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400">
                        Length (in)
                      </span>
                      <input
                        type="number"
                        step={0.125}
                        value={block.lengthIn}
                        onChange={(e) => {
                          const snapped = snapInches(
                            Number(e.target.value),
                          );
                          updateBlockDims({ lengthIn: snapped });
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
                        value={block.widthIn}
                        onChange={(e) => {
                          const snapped = snapInches(
                            Number(e.target.value),
                          );
                          updateBlockDims({ widthIn: snapped });
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400">
                        Thickness
                      </span>
                      <input
                        type="number"
                        step={0.125}
                        value={block.thicknessIn}
                        onChange={(e) => {
                          const snapped = snapInches(
                            Number(e.target.value),
                          );
                          updateBlockDims({ thicknessIn: snapped });
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                  </div>
                </div>

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
                      Name + email are required before recommending foam or
                      applying to the quote.
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">
                        Customer name{" "}
                        <span className="text-rose-300">*</span>
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
                      <span className="font-semibold">Recommend my foam</span>{" "}
                      and <span className="font-semibold">Apply to quote</span>.
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
                      No cavities yet. Use the palette on the left to add a
                      pocket.
                    </div>
                  ) : (
                    <ul className="mt-2 space-y-1.5 mb-3 max-h-40 overflow-auto">
                      {cavities.map((cav, cavIndex) => {
                        const isActive = cav.id === selectedId;

                        const color =
                          CAVITY_COLORS[cavIndex % CAVITY_COLORS.length];
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
                                isActive
                                  ? selectCavity(null)
                                  : selectCavity(cav.id)
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
                      <span>
                        Select a cavity above to edit its size and depth.
                      </span>
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
                              onBlur={() =>
                                commitCavityField("cornerRadius")
                              }
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
          </div>
        </div>
      </div>
    </main>
  );
}
// ===== SVG export helper =====

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type SvgOpts = {
  notes?: string;
  materialLabel?: string;
};

/**
 * Build an SVG string for saving with the quote.
 * Mirrors the on-screen layout:
 *  - Same overall canvas size
 *  - Block scaled + centered
 *  - Cavities drawn with labels
 *  - Optional notes + material line in the header band
 */
function buildSvgFromLayout(layout: LayoutModel, opts: SvgOpts = {}): string {
  const { block, cavities } = layout;
  const notes = opts.notes ?? "";
  const materialLabel = opts.materialLabel ?? "";

  const SVG_W = 1200;
  const SVG_H = 620;
  const HEADER_BAND = 80;
  const PADDING = 32;
  const WALL_IN = 0.5;

  if (!block.lengthIn || !block.widthIn) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
  <rect width="100%" height="100%" fill="#020617" />
  <text x="${SVG_W / 2}" y="${SVG_H / 2}" fill="#e5e7eb" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="16" text-anchor="middle">
    No block dimensions
  </text>
</svg>`;
  }

  const innerW = SVG_W - PADDING * 2;
  const innerH = SVG_H - PADDING * 2 - HEADER_BAND;

  const sx = innerW / (block.lengthIn || 1);
  const sy = innerH / (block.widthIn || 1);
  const scale = Math.min(sx, sy);

  const blockPxWidth = block.lengthIn * scale;
  const blockPxHeight = block.widthIn * scale;

  const blockOffsetX = (SVG_W - blockPxWidth) / 2;
  const blockOffsetY = HEADER_BAND + (SVG_H - HEADER_BAND - blockPxHeight) / 2;

  const wallPxX = (WALL_IN / block.lengthIn) * blockPxWidth;
  const wallPxY = (WALL_IN / block.widthIn) * blockPxHeight;

  const lines: string[] = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">`,
  );
  lines.push(`<rect width="100%" height="100%" fill="#020617" />`);

  // Header band
  lines.push(
    `<rect x="0" y="0" width="${SVG_W}" height="${HEADER_BAND}" fill="#020617" />`,
  );

  const headerTitle = "FOAM LAYOUT — NOT TO SCALE";
  const headerBlockLine = `Block ${block.lengthIn.toFixed(
    3,
  )}" × ${block.widthIn.toFixed(3)}" × ${
    block.thicknessIn != null ? block.thicknessIn.toFixed(3) : "?"
  }" thick`;

  lines.push(
    `<text x="${SVG_W / 2}" y="24" fill="#e5e7eb" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" text-anchor="middle" font-weight="600">${escapeXml(
      headerTitle,
    )}</text>`,
  );
  lines.push(
    `<text x="${SVG_W / 2}" y="44" fill="#9ca3af" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" text-anchor="middle">${escapeXml(
      headerBlockLine,
    )}</text>`,
  );

  if (materialLabel) {
    lines.push(
      `<text x="${SVG_W / 2}" y="62" fill="#a5b4fc" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="11" text-anchor="middle">${escapeXml(
        materialLabel,
      )}</text>`,
    );
  }

  // Notes block (if present)
  if (notes.trim().length > 0) {
    const noteLines = notes.trim().split(/\r?\n/).slice(0, 6); // cap a bit
    const baseY = HEADER_BAND + 18;
    const x = PADDING;
    const w = SVG_W - PADDING * 2;
    const h = noteLines.length * 14 + 12;

    lines.push(
      `<rect x="${x}" y="${baseY - 16}" width="${w}" height="${h}" fill="#020617" stroke="#1f2937" stroke-width="1" />`,
    );
    lines.push(
      `<text x="${x + 8}" y="${baseY - 4}" fill="#9ca3af" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10" font-weight="600">Notes / special instructions</text>`,
    );

    let offset = 0;
    for (const ln of noteLines) {
      lines.push(
        `<text x="${x + 8}" y="${baseY + 12 + offset}" fill="#e5e7eb" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10">${escapeXml(
          ln,
        )}</text>`,
      );
      offset += 14;
    }
  }

  // Block body (simple rectangle; cropping is currently a visual-only toggle in the editor)
  const blockX = blockOffsetX;
  const blockY = blockOffsetY;

  lines.push(
    `<rect x="${blockX}" y="${blockY}" width="${blockPxWidth}" height="${blockPxHeight}" fill="#020617" stroke="#e5e7eb" stroke-width="1.5" />`,
  );

  // Inner usable area (0.5" wall)
  lines.push(
    `<rect x="${blockX + wallPxX}" y="${
      blockY + wallPxY
    }" width="${blockPxWidth - wallPxX * 2}" height="${
      blockPxHeight - wallPxY * 2
    }" fill="none" stroke="#4b5563" stroke-dasharray="4 3" stroke-width="1" />`,
  );

  // Cavities
  cavities.forEach((cav, idx) => {
    const cavLeftIn = cav.x * block.lengthIn;
    const cavTopIn = cav.y * block.widthIn;
    const cavRightIn = cavLeftIn + cav.lengthIn;
    const cavBottomIn = cavTopIn + cav.widthIn;

    const cavX =
      blockX + (cavLeftIn / block.lengthIn) * blockPxWidth;
    const cavY = blockY + (cavTopIn / block.widthIn) * blockPxHeight;
    const cavW =
      ((cavRightIn - cavLeftIn) / block.lengthIn) * blockPxWidth;
    const cavH =
      ((cavBottomIn - cavTopIn) / block.widthIn) * blockPxHeight;

    const color = CAVITY_COLORS[idx % CAVITY_COLORS.length];

    if (cav.shape === "circle") {
      const cx = cavX + cavW / 2;
      const cy = cavY + cavH / 2;
      const r = Math.min(cavW, cavH) / 2;

      lines.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="1.4" />`,
      );
    } else if (cav.shape === "roundedRect") {
      // simple rounded rect using cavity.cornerRadiusIn
      const rIn = cav.cornerRadiusIn ?? 0.25;
      const rx = (rIn / block.lengthIn) * blockPxWidth;
      const ry = (rIn / block.widthIn) * blockPxHeight;

      lines.push(
        `<rect x="${cavX}" y="${cavY}" width="${cavW}" height="${cavH}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="1.4" />`,
      );
    } else {
      lines.push(
        `<rect x="${cavX}" y="${cavY}" width="${cavW}" height="${cavH}" fill="none" stroke="${color}" stroke-width="1.4" />`,
      );
    }

    // Label
    const label = cav.label || "";
    if (label) {
      lines.push(
        `<text x="${cavX + cavW / 2}" y="${
          cavY + cavH / 2 + 4
        }" fill="#e5e7eb" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="11" text-anchor="middle">${escapeXml(
          label,
        )}</text>`,
      );
    }
  });

  lines.push(`</svg>`);
  return lines.join("\n");
}
