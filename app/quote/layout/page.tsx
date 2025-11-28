// app/quote/layout/page.tsx
//
// Layout editor host page (wide).
// - Left: palette + notes
// - Center: large canvas
// - Right: block + cavity inspector
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
//   seeded from the primary quote item when available.
// - If the URL includes an explicit `cavities=` param, we treat that as fresh
//   and ignore any saved DB layout geometry for the initial load, so
//   email → layout always reflects the latest cavity dims instead of an
//   old 3x2x1 test layout.
//

"use client";

import * as React from "react";

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
function normalizeDimsParam(
  raw: string | string[] | undefined
): string {
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
 * - NEW: de-duplicate identical strings
 */
function normalizeCavitiesParam(
  raw: string | string[] | undefined
): string {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map((s) => s.trim())
      .filter(Boolean);
    const unique: string[] = [];
    for (const val of cleaned) {
      if (!unique.includes(val)) unique.push(val);
    }
    return unique.join(";");
  }
  return raw.trim();
}

const SNAP_IN = 0.125;
const WALL_IN = 0.5;

// Parse LxWxH
function parseDimsTriple(
  raw: string | undefined | null
): { L: number; W: number; H: number } | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/
  );
  if (!m) return null;
  const L = Number(m[1]) || 0;
  const W = Number(m[2]) || 0;
  const H = Number(m[3]) || 0;
  if (!L || !W || !H) return null;
  return { L, W, H };
}

// Parse LxW or LxWxD
function parseCavityDims(
  raw: string
): { L: number; W: number; D: number } | null {
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  let m =
    t.match(
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/
    ) || null;
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    const D = Number(m[3]) || 0;
    if (!L || !W || !D) return null;
    return { L, W, D };
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
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
  /* ---------- Quote number ---------- */

  const initialQuoteNoParam = (searchParams?.quote_no ??
    searchParams?.quote ??
    "") as string | string[] | undefined;

  const [quoteNoFromUrl, setQuoteNoFromUrl] = React.useState<string>(
    Array.isArray(initialQuoteNoParam)
      ? initialQuoteNoParam[0]?.trim() || ""
      : initialQuoteNoParam?.trim() || ""
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

  /* ---------- Other URL params ---------- */

  const hasDimsFromUrl =
    typeof searchParams?.dims !== "undefined" ||
    typeof searchParams?.block !== "undefined";

  const hasCavitiesFromUrl =
    typeof searchParams?.cavities !== "undefined" ||
    typeof searchParams?.cavity !== "undefined";

  const serverBlockStr = normalizeDimsParam(
    (searchParams?.dims ??
      searchParams?.block) as string | string[] | undefined
  );

  const serverCavityStr = normalizeCavitiesParam(
    (searchParams?.cavities ??
      searchParams?.cavity) as string | string[] | undefined
  );

  const hasExplicitCavities =
    hasCavitiesFromUrl && serverCavityStr.length > 0;

  const hasRealQuoteNo =
    !!quoteNoFromUrl && quoteNoFromUrl.trim().length > 0;

  const quoteNo = hasRealQuoteNo
    ? quoteNoFromUrl.trim()
    : "Q-AI-EXAMPLE";

  /* ---------- Build initial layout ---------- */

  const [initialLayout, setInitialLayout] =
    React.useState<LayoutModel | null>(null);
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(
    null
  );
  const [loadingLayout, setLoadingLayout] =
    React.useState<boolean>(true);

  const buildFallbackLayout = React.useCallback(
    (blockStr: string, cavityStr: string): LayoutModel => {
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
            Math.max(block.lengthIn - 2 * WALL_IN, 1) ||
            block.lengthIn;
          const availH =
            Math.max(block.widthIn - 2 * WALL_IN, 1) ||
            block.widthIn;

          const cellW = availW / cols;
          const cellH = availH / rows;

          parsedCavs.forEach((c, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            const rawX =
              WALL_IN + col * cellW + (cellW - c.L) / 2;
            const rawY =
              WALL_IN + row * cellH + (cellH - c.W) / 2;

            const clamp = (v: number, min: number, max: number) =>
              v < min ? min : v > max ? max : v;

            const minX = WALL_IN;
            const maxX = block.lengthIn - WALL_IN - c.L;
            const minY = WALL_IN;
            const maxY = block.widthIn - WALL_IN - c.W;

            const xIn = clamp(rawX, minX, Math.max(minX, maxX));
            const yIn = clamp(rawY, minY, Math.max(minY, maxY));

            const xNorm =
              block.lengthIn > 0 ? xIn / block.lengthIn : 0.1;
            const yNorm =
              block.widthIn > 0 ? yIn / block.widthIn : 0.1;

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

      return {
        block,
        cavities,
      };
    },
    []
  );

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingLayout(true);

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
          url.searchParams
            .getAll("cavities")
            .forEach((v) => v && cavityParts.push(v));
          url.searchParams
            .getAll("cavity")
            .forEach((v) => v && cavityParts.push(v));

          if (dimsCandidates.length > 0) {
            effectiveBlockStr = normalizeDimsParam(
              dimsCandidates[0]
            );
          }

          if (cavityParts.length > 0) {
            effectiveCavityStr = normalizeCavitiesParam(
              cavityParts
            );
          }
        }
      } catch {
        // ignore
      }

      try {
        if (!hasRealQuoteNo) {
          const fallback = buildFallbackLayout(
            effectiveBlockStr,
            effectiveCavityStr
          );
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(null);
            setLoadingLayout(false);
          }
          return;
        }

        const res = await fetch(
          "/api/quote/print?quote_no=" +
            encodeURIComponent(quoteNoFromUrl.trim()),
          { cache: "no-store" }
        );

        if (!res.ok) {
          const fallback = buildFallbackLayout(
            effectiveBlockStr,
            effectiveCavityStr
          );
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(null);
            setLoadingLayout(false);
          }
          return;
        }

        const json = await res.json();

        let qtyFromItems: number | null = null;
        if (Array.isArray(json.items) && json.items.length > 0) {
          const rawQty = Number(json.items[0]?.qty);
          if (Number.isFinite(rawQty) && rawQty > 0) {
            qtyFromItems = rawQty;
          }
        }

        if (
          json &&
          json.ok &&
          json.layoutPkg &&
          json.layoutPkg.layout_json &&
          !hasExplicitCavities &&
          !hasDimsFromUrl &&
          !hasCavitiesFromUrl
        ) {
          const layoutFromDb = json.layoutPkg
            .layout_json as LayoutModel;
          const notesFromDb =
            (json.layoutPkg.notes as string | null) ?? "";

          if (!cancelled) {
            setInitialLayout(layoutFromDb);
            setInitialNotes(notesFromDb);
            setInitialQty(qtyFromItems);
            setLoadingLayout(false);
          }
          return;
        }

        const fallback = buildFallbackLayout(
          effectiveBlockStr,
          effectiveCavityStr
        );
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(qtyFromItems);
          setLoadingLayout(false);
        }
      } catch (err) {
        console.error("Error loading layout for /quote/layout:", err);
        const fallback = buildFallbackLayout(
          effectiveBlockStr,
          effectiveCavityStr
        );
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(null);
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
  ]);

  if (loadingLayout || !initialLayout) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-sm text-slate-300">
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
    />
  );
}

/* ---------- Layout editor host ---------- */

function LayoutEditorHost(props: {
  quoteNo: string;
  hasRealQuoteNo: boolean;
  initialLayout: LayoutModel;
  initialNotes: string;
  initialQty: number | null;
}) {
  const {
    quoteNo,
    hasRealQuoteNo,
    initialLayout,
    initialNotes,
    initialQty,
  } = props;

  const {
    layout,
    selectedId,
    selectCavity,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
  } = useLayoutModel(initialLayout);

  const [zoom, setZoom] = React.useState(1);
  const [notes, setNotes] = React.useState(initialNotes || "");
  const [applyStatus, setApplyStatus] = React.useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [qty, setQty] = React.useState<number | "">(
    initialQty != null ? initialQty : ""
  );

  const [materials, setMaterials] =
    React.useState<MaterialOption[]>([]);
  const [materialsLoading, setMaterialsLoading] =
    React.useState<boolean>(true);
  const [materialsError, setMaterialsError] = React.useState<
    string | null
  >(null);
  const [selectedMaterialId, setSelectedMaterialId] =
    React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const res = await fetch("/api/materials", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();

        if (!cancelled && Array.isArray(json.materials)) {
          const mapped: MaterialOption[] = json.materials.map(
            (m: any) => ({
              id: m.id,
              name: m.name,
              family: m.material_family || "Uncategorized",
              density_lb_ft3:
                typeof m.density_lb_ft3 === "number"
                  ? m.density_lb_ft3
                  : m.density_lb_ft3 != null
                  ? Number(m.density_lb_ft3)
                  : null,
            })
          );
          setMaterials(mapped);
        }
      } catch (err) {
        console.error("Error loading materials", err);
        if (!cancelled) {
          setMaterialsError(
            "Couldn’t load material list. You can still edit the layout."
          );
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

  const materialsByFamily = React.useMemo(() => {
    const map = new Map<string, MaterialOption[]>();
    for (const m of materials) {
      const key = m.family || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(map.entries());
  }, [materials]);

  const { block, cavities } = layout;
  const selectedCavity =
    cavities.find((c) => c.id === selectedId) || null;

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

  const handleApplyToQuote = async () => {
    if (!hasRealQuoteNo) {
      alert(
        "This layout preview isn’t linked to a quote yet.\n\nOpen this page from an emailed quote or from the /quote print view so Alex-IO knows which quote to save it against."
      );
      return;
    }

    try {
      setApplyStatus("saving");

      const svg = buildSvgFromLayout(layout);

      const payload: any = {
        quoteNo,
        layout,
        notes,
        svg,
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
              `Couldn’t find a quote header for ${quoteNo}.\n\nOpen this layout link from a real quote email or print view.`
            );
          }
        } catch {}
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

  return (
    <main className="min-h-screen bg-slate-950 flex items-stretch py-8 px-4">
      <div className="w-full max-w-none mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow-[0_22px_45px_rgba(15,23,42,0.85)] overflow-hidden">
          {/* Header */}
          <div className="border-b border-slate-800 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
            {/* Body: three-column layout */}
            <div className="flex flex-row gap-5 p-5 bg-slate-950/80 text-slate-100">

              {/* LEFT SIDEBAR */}
              <aside className="w-52 shrink-0 flex flex-col gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Cavity palette
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Click to add a cavity style to the layout.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleAddPreset("rect")}
                  className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
                >
                  <div className="font-semibold text-slate-50">Rectangle</div>
                  <div className="text-[11px] text-slate-400">
                    Rectangular pocket (4&quot; × 2&quot;)
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddPreset("circle")}
                  className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
                >
                  <div className="font-semibold text-slate-50">Circle</div>
                  <div className="text-[11px] text-slate-400">
                    Round pocket (3&quot; Ø)
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddPreset("roundedRect")}
                  className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
                >
                  <div className="font-semibold text-slate-50">
                    Rounded rectangle
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Rounded corners (4&quot; × 3&quot;, 0.5&quot; R)
                  </div>
                </button>

                {/* MATERIAL DROPDOWN */}
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Foam material
                  </div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Choose the foam family + grade.
                  </div>

                  <select
                    value={selectedMaterialId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) setSelectedMaterialId(null);
                      else {
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

                {/* NOTES */}
                <div className="mt-3 bg-slate-900/80 rounded-2xl border border-slate-700 p-3">
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Notes / special instructions
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 resize-vertical"
                  />
                </div>

                <div className="text-[11px] text-slate-500 mt-2">
                  Cavities snap to 0.125&quot; increments.
                </div>

                {!hasRealQuoteNo && (
                  <div className="mt-3 rounded-xl border border-amber-500/70 bg-amber-900/50 px-3 py-2 text-[11px] text-amber-50">
                    No quote linked. Open from an emailed quote to save changes.
                  </div>
                )}
              </aside>

              {/* CENTER CANVAS */}
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
                    <div className="text-xs text-slate-400 mt-1">
                      Block{" "}
                      <span className="font-mono font-semibold text-slate-100">
                        {block.lengthIn}" × {block.widthIn}" ×{" "}
                        {block.thicknessIn || 0}"
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
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
                    </div>

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
                      onClick={handleApplyToQuote}
                      disabled={!hasRealQuoteNo || applyStatus === "saving"}
                      className="inline-flex items-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition disabled:opacity-60"
                    >
                      {!hasRealQuoteNo
                        ? "Link to a quote first"
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

                <p className="text-[11px] text-slate-400 leading-snug">
                  Drag cavities to adjust placement. Use the handle to resize.
                </p>

                <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 p-4 overflow-auto">
                  <InteractiveCanvas
                    layout={layout}
                    selectedId={selectedId}
                    selectAction={selectCavity}
                    moveAction={updateCavityPosition}
                    resizeAction={(id, lengthIn, widthIn) =>
                      updateCavityDims(id, { lengthIn, widthIn })
                    }
                    zoom={zoom}
                  />
                </div>
              </section>

              {/* RIGHT SIDEBAR: INSPECTOR */}
              <aside className="w-70 shrink-0 flex flex-col gap-3">

                {/* BLOCK EDITOR */}
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Block
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
                          const snapped = snapInches(Number(e.target.value));
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
                          const snapped = snapInches(Number(e.target.value));
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
                          const snapped = snapInches(Number(e.target.value));
                          updateBlockDims({ thicknessIn: snapped });
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                  </div>
                </div>

                {/* CAVITY LIST */}
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3 flex-1 flex flex-col">
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    Cavities
                  </div>

                  {cavities.length === 0 ? (
                    <div className="text-xs text-slate-400">
                      No cavities. Use palette to add.
                    </div>
                  ) : (
                    <ul className="space-y-1.5 mb-3 max-h-40 overflow-auto">
                      {cavities.map((cav) => {
                        const isActive = cav.id === selectedId;
                        return (
                          <li
                            key={cav.id}
                            className="flex items-center justify-between gap-2"
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
                                className={[
                                  "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
                                  isActive
                                    ? "bg-sky-500 text-slate-950"
                                    : "bg-sky-900/70 text-sky-100",
                                ].join(" ")}
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
                      <span>Select a cavity to edit.</span>
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
                              value={selectedCavity.lengthIn}
                              onChange={(e) => {
                                const d = snapInches(Number(e.target.value));
                                updateCavityDims(selectedCavity.id, {
                                  lengthIn: d,
                                  widthIn: d,
                                });
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
                              value={selectedCavity.depthIn}
                              onChange={(e) =>
                                updateCavityDims(selectedCavity.id, {
                                  depthIn: Number(e.target.value),
                                })
                              }
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
                              value={selectedCavity.lengthIn}
                              onChange={(e) =>
                                updateCavityDims(selectedCavity.id, {
                                  lengthIn: snapInches(Number(e.target.value)),
                                })
                              }
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
                              value={selectedCavity.widthIn}
                              onChange={(e) =>
                                updateCavityDims(selectedCavity.id, {
                                  widthIn: snapInches(Number(e.target.value)),
                                })
                              }
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
                              value={selectedCavity.depthIn}
                              onChange={(e) =>
                                updateCavityDims(selectedCavity.id, {
                                  depthIn: Number(e.target.value),
                                })
                              }
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
                              value={selectedCavity.cornerRadiusIn}
                              onChange={(e) =>
                                updateCavityDims(selectedCavity.id, {
                                  cornerRadiusIn: snapInches(
                                    Number(e.target.value)
                                  ),
                                })
                              }
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

/* ---------- SVG EXPORT HELPER (FULL, COMPLETE, FIXED) ---------- */

function buildSvgFromLayout(layout: LayoutModel): string {
  const { block, cavities } = layout;

  const VIEW_W = 1000;
  const VIEW_H = 700;
  const PADDING = 40;

  const scaleX = (VIEW_W - 2 * PADDING) / block.lengthIn;
  const scaleY = (VIEW_H - 2 * PADDING) / block.widthIn;
  const scale = Math.min(scaleX, scaleY);

  const blockW = block.lengthIn * scale;
  const blockH = block.widthIn * scale;
  const blockX = (VIEW_W - blockW) / 2;
  const blockY = (VIEW_H - blockH) / 2;

  const cavRects = cavities
    .map((c) => {
      const cavW = c.lengthIn * scale;
      const cavH = c.widthIn * scale;
      const x = blockX + c.x * blockW;
      const y = blockY + c.y * blockH;

      const label =
        c.label ?? `${c.lengthIn}×${c.widthIn}×${c.depthIn}"`;

      if (c.shape === "circle") {
        const r = Math.min(cavW, cavH) / 2;
        const cx = x + cavW / 2;
        const cy = y + cavH / 2;
        return `
      <g>
        <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(
          2
        )}" r="${r.toFixed(2)}" fill="none" stroke="#111827" stroke-width="1" />
        <text x="${cx.toFixed(2)}" y="${cy.toFixed(
          2
        )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${label}</text>
      </g>`;
      }

      return `
      <g>
        <rect x="${x.toFixed(2)}" y="${y.toFixed(
        2
      )}" width="${cavW.toFixed(2)}" height="${cavH.toFixed(2)}"
          rx="${(
            c.cornerRadiusIn ? c.cornerRadiusIn * scale : 0
          ).toFixed(2)}"
          ry="${(
            c.cornerRadiusIn ? c.cornerRadiusIn * scale : 0
          ).toFixed(2)}"
          fill="none" stroke="#111827" stroke-width="1" />
        <text x="${(x + cavW / 2).toFixed(2)}" y="${(
        y + cavH / 2
      ).toFixed(
        2
      )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${label}</text>
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}"
     xmlns="http://www.w3.org/2000/svg">
  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(
    2
  )}" width="${blockW.toFixed(2)}" height="${blockH.toFixed(
    2
  )}" fill="none" stroke="#111827" stroke-width="2" />
  ${cavRects}
</svg>`;
}
