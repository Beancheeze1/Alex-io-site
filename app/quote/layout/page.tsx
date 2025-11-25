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
// - If no saved layout exists, it falls back to the old default layout
//   (dims/cavities from query string, then 10x10x2 + 3x2x1).
// - After a successful "Apply to quote", automatically navigates to
//   /quote?quote_no=... so the user sees the updated printable quote.
// - NEW: Shows editable Qty in the top-right next to Zoom / Apply,
//   seeded from the primary quote item when available.
// - NEW (11/23 fix): If the URL includes an explicit `cavities=` param,
//   we treat that as fresh and ignore any saved DB layout geometry for
//   the initial load, so email → layout always reflects the latest
//   cavity dims instead of an old 3x2x1 test layout.
// - NEW (11/24): If the URL includes `qty=` and the DB doesn't have an
//   item yet, seed the Qty field from the URL so the first reply's qty
//   flows into the editor.
//

"use client";

import * as React from "react";

import {
  buildLayoutFromStrings,
  CavityShape,
  LayoutModel,
} from "./editor/layoutTypes";
import { useLayoutModel } from "./editor/useLayoutModel";
import InteractiveCanvas from "./editor/InteractiveCanvas";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

function normalizeDimsParam(raw: string | undefined): string {
  if (!raw || !raw.trim()) return "10x10x2";
  return raw.trim();
}

function normalizeCavitiesParam(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim();
}

// Ensure all dimension edits snap to 0.125"
const SNAP_IN = 0.125;
const WALL_IN = 0.5;

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

  // Initial guess from Next.js-provided searchParams
  const initialQuoteNoParam = (searchParams?.quote_no ??
    searchParams?.quote ??
    "") as string | undefined;

  const [quoteNoFromUrl, setQuoteNoFromUrl] = React.useState<string>(
    initialQuoteNoParam?.trim() || "",
  );

  // On the client, re-parse the real address bar so we always match
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
      // If anything goes wrong, just stick with the initial value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Other URL params (dims, cavities, qty) ---------- */

  const dimsParam = (searchParams?.dims ??
    searchParams?.block ??
    "") as string | undefined;

  const cavitiesParam = (searchParams?.cavities ??
    searchParams?.cavity ??
    "") as string | undefined;

  // NEW: read qty= from URL so first email can seed the editor
  const qtyParamRaw = (searchParams?.qty ??
    searchParams?.q ??
    "") as string | undefined;

  const qtyFromUrl: number | null = (() => {
    if (!qtyParamRaw) return null;
    const trimmed = String(qtyParamRaw).trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  })();

  const blockStr = normalizeDimsParam(dimsParam);
  const cavityStr = normalizeCavitiesParam(cavitiesParam);

  const hasExplicitCavities =
    !!cavitiesParam && cavitiesParam.trim().length > 0;

  const hasRealQuoteNo =
    !!quoteNoFromUrl && quoteNoFromUrl.trim().length > 0;

  const quoteNo = hasRealQuoteNo
    ? quoteNoFromUrl.trim()
    : "Q-AI-EXAMPLE";

  /* ---------- Build initial layout (from DB if available) ---------- */

  const [initialLayout, setInitialLayout] = React.useState<
    LayoutModel | null
  >(null);
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(
    null,
  );
  const [loadingLayout, setLoadingLayout] =
    React.useState<boolean>(true);

  // Helper: fallback layout builder
  const buildFallbackLayout = React.useCallback((): LayoutModel => {
    const fromQuery = buildLayoutFromStrings(blockStr, cavityStr);
    if (fromQuery) return fromQuery;

    // Fallback: 10×10×2 block with ONE sample cavity 3×2×1
    return (
      buildLayoutFromStrings("10x10x2", "3x2x1") || {
        block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 },
        cavities: [],
      }
    );
  }, [blockStr, cavityStr]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingLayout(true);

      try {
        // If we don't have a real quote number, just use fallback layout
        // and seed qty from URL if present.
        if (!hasRealQuoteNo) {
          const fallback = buildFallbackLayout();
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(qtyFromUrl);
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
          // If the quote isn't found or API fails, fall back to local defaults.
          // For qty, prefer URL qty if DB has nothing yet.
          const fallback = buildFallbackLayout();
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes("");
            setInitialQty(qtyFromUrl);
            setLoadingLayout(false);
          }
          return;
        }

        const json = await res.json();

        // Try to pull qty from primary line item (if present)
        let qtyFromItems: number | null = null;
        if (Array.isArray(json.items) && json.items.length > 0) {
          const rawQty = Number(json.items[0]?.qty);
          if (Number.isFinite(rawQty) && rawQty > 0) {
            qtyFromItems = rawQty;
          }
        }

        // KEY BEHAVIOR:
        // If the URL includes explicit `cavities=...`, we treat that as the
        // source of truth for the initial layout and IGNORE any saved DB
        // layout_json for geometry. We still keep qtyFromItems if present.
        //
        // This prevents an older 3x2x1 test layout from overriding fresh
        // 1x1x0.5 style cavity dims coming from the quote email.
        if (
          json &&
          json.ok &&
          json.layoutPkg &&
          json.layoutPkg.layout_json &&
          !hasExplicitCavities
        ) {
          const layoutFromDb = json.layoutPkg.layout_json as LayoutModel;
          const notesFromDb =
            (json.layoutPkg.notes as string | null) ?? "";

          if (!cancelled) {
            setInitialLayout(layoutFromDb);
            setInitialNotes(notesFromDb);
            // Prefer DB item qty; if none yet, fall back to qtyFromUrl
            setInitialQty(qtyFromItems ?? qtyFromUrl);
            setLoadingLayout(false);
          }
          return;
        }

        // Otherwise, fall back to layout from URL (dims/cavities) and
        // keep qty if we have it (DB first, then URL).
        const fallback = buildFallbackLayout();
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(qtyFromItems ?? qtyFromUrl);
          setLoadingLayout(false);
        }
      } catch (err) {
        console.error("Error loading layout for /quote/layout:", err);
        const fallback = buildFallbackLayout();
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes("");
          setInitialQty(qtyFromUrl);
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
    qtyFromUrl,
  ]);

  if (loadingLayout || !initialLayout) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-sm text-slate-600">
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

/* ---------- Layout editor host (was main body) ---------- */

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
    initialQty != null ? initialQty : "",
  );

  const { block, cavities } = layout;
  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  /* ---------- Palette Interactions ---------- */

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

  /* ---------- Center selected cavity in block ---------- */

  const handleCenterSelectedCavity = () => {
    if (!selectedCavity) return;

    const len = selectedCavity.lengthIn;
    const wid = selectedCavity.widthIn;

    if (!block.lengthIn || !block.widthIn || !len || !wid) return;

    // center so cavity center = block center, respect 0.5" wall + snap
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

  /* ---------- Apply to quote ---------- */

  const handleApplyToQuote = async () => {
    // Guard: must be linked to a real quote number
    if (!hasRealQuoteNo) {
      alert(
        "This layout preview isn’t linked to a quote yet.\n\nOpen this page from an emailed quote or from the /quote print view so Alex-IO knows which quote to save it against.",
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

      // ✅ Qty fix: always coerce to a number before sending
      const nQty = Number(qty);
      if (Number.isFinite(nQty) && nQty > 0) {
        payload.qty = nQty;
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
            console.error("layout apply quote_not_found", payloadJson);
            alert(
              `Couldn’t find a quote header for ${quoteNo}.\n\nMake sure this layout link came from a real quote email or print view so the header exists in the database.`,
            );
          }
        } catch {
          // ignore
        }
        throw new Error(`HTTP ${res.status}`);
      }

      // ✅ Success: jump straight to printable quote so there’s no confusion
      if (typeof window !== "undefined") {
        window.location.href =
          "/quote?quote_no=" + encodeURIComponent(quoteNo);
        return;
      }

      // Fallback (non-browser)
      setApplyStatus("done");
      setTimeout(() => setApplyStatus("idle"), 2000);
    } catch (err) {
      console.error("Apply-to-quote failed", err);
      setApplyStatus("error");
      setTimeout(() => setApplyStatus("idle"), 3000);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-stretch">
      <div className="w-full mx-auto bg-white rounded-none shadow-none border-t border-slate-200 flex flex-row gap-6 p-6">
        {/* ---------- LEFT: Cavity palette + notes ---------- */}
        <aside className="w-64 shrink-0 flex flex-col gap-3 border-r border-slate-200 pr-4">
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Cavity palette
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              Click a style to add a new pocket, then drag and resize it in the
              block.
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleAddPreset("rect")}
            className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50/50 transition"
          >
            <div className="font-semibold text-slate-800">Rectangle</div>
            <div className="text-[11px] text-slate-500">
              Rectangular pocket (4&quot; × 2&quot;)
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleAddPreset("circle")}
            className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50/50 transition"
          >
            <div className="font-semibold text-slate-800">Circle</div>
            <div className="text-[11px] text-slate-500">
              Round pocket (3&quot; Ø)
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleAddPreset("roundedRect")}
            className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50/50 transition"
          >
            <div className="font-semibold text-slate-800">
              Rounded rectangle
            </div>
            <div className="text-[11px] text-slate-500">
              Rounded corners (4&quot; × 3&quot;, 0.5&quot; R)
            </div>
          </button>

          {/* Notes / special instructions */}
          <div className="mt-2 bg-slate-50 rounded-2xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Notes / special instructions
            </div>
            <div className="text-[11px] text-slate-500 mb-2">
              Optional text for anything the foam layout needs to call out
              (loose parts, labels, extra protection, etc.). This will be saved
              with the quote when you apply.
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs resize-vertical"
            />
          </div>

          <div className="mt-1 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            Cavities snap to 0.125&quot; and keep 0.5&quot; walls to block
            edges and between pockets.
          </div>

          {!hasRealQuoteNo && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              No quote is linked yet. Open this page from an emailed quote or
              the /quote print view to save layouts back to a real quote.
            </div>
          )}
        </aside>

        {/* ---------- CENTER: Big visualizer ---------- */}
        <section className="flex-1 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-900">
                <span className="font-semibold">
                  Foam layout preview (TEST XYZ)
                </span>

                <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-medium">
                  BETA – interactive layout
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Quote{" "}
                <span className="font-mono font-semibold text-slate-800">
                  {quoteNo}
                </span>
                {" • "}
                {block.lengthIn}" × {block.widthIn}" ×{" "}
                {block.thicknessIn || 0}" block
              </div>
              {!hasRealQuoteNo && (
                <div className="text-[11px] text-amber-700 mt-0.5">
                  Demo only – link from a real quote email to apply layouts.
                </div>
              )}
            </div>

            {/* zoom + qty + apply button (no more "view printable quote") */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <span>Zoom</span>
                <input
                  type="range"
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-28"
                />
              </div>

              <div className="flex items-center gap-1 text-[11px] text-slate-500">
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
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </div>

              <button
                type="button"
                onClick={handleApplyToQuote}
                disabled={!hasRealQuoteNo || applyStatus === "saving"}
                className="inline-flex items-center rounded-full border border-slate-200 bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition disabled:opacity-60"
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

          <p className="text-[11px] text-slate-500 leading-snug">
            Drag cavities to adjust placement. Use the square handle at the
            bottom-right of each cavity to resize. Cavities are placed inside a
            0.5&quot; wall on all sides. When a cavity is selected, the nearest
            horizontal and vertical gaps to other cavities and to the block
            edges are dimensioned.
          </p>

          {/* canvas wrapper */}
          <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 p-4 overflow-auto">
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

        {/* ---------- RIGHT: Inspector ---------- */}
        <aside className="w-80 shrink-0 flex flex-col gap-3 border-l border-slate-200 pl-4">
          {/* Block editor */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Block
            </div>
            <div className="text-[11px] text-slate-500 mb-2">
              Edit the foam blank size. Values snap to 0.125&quot; increments.
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">Length (in)</span>
                <input
                  type="number"
                  step={0.125}
                  value={block.lengthIn}
                  onChange={(e) => {
                    const snapped = snapInches(Number(e.target.value));
                    updateBlockDims({ lengthIn: snapped });
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">Width (in)</span>
                <input
                  type="number"
                  step={0.125}
                  value={block.widthIn}
                  onChange={(e) => {
                    const snapped = snapInches(Number(e.target.value));
                    updateBlockDims({ widthIn: snapped });
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">Thickness</span>
                <input
                  type="number"
                  step={0.125}
                  value={block.thicknessIn}
                  onChange={(e) => {
                    const snapped = snapInches(Number(e.target.value));
                    updateBlockDims({ thicknessIn: snapped });
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
            </div>
          </div>

          {/* Cavities list + editor */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3 flex-1 flex flex-col">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Cavities
            </div>

            {cavities.length === 0 ? (
              <div className="text-xs text-slate-500">
                No cavities yet. Use the palette on the left to add a pocket.
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
                          isActive ? selectCavity(null) : selectCavity(cav.id)
                        }
                        className="flex-1 flex items-center gap-2 text-xs text-left"
                      >
                        <span
                          className={[
                            "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
                            isActive
                              ? "bg-indigo-600 text-white"
                              : "bg-indigo-100 text-indigo-700",
                          ].join(" ")}
                        >
                          {cav.id.replace("cav-", "C")}
                        </span>
                        <span
                          className={
                            isActive
                              ? "text-slate-900 font-medium"
                              : "text-slate-700"
                          }
                        >
                          {cav.label}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCavity(cav.id)}
                        className="text-[11px] text-slate-400 hover:text-red-500"
                        title="Delete cavity"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
              {selectedCavity ? (
                <span>
                  Editing <strong>{selectedCavity.label}</strong>
                </span>
              ) : (
                <span>Select a cavity above to edit its size and depth.</span>
              )}
            </div>

            {selectedCavity && (
              <>
                {/* circle uses Diameter; others use Length + Width */}
                {selectedCavity.shape === "circle" ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">
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
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">
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
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">
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
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">
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
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">
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
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">
                        Corner radius (in)
                      </span>
                      <input
                        type="number"
                        step={0.125}
                        value={selectedCavity.cornerRadiusIn}
                        onChange={(e) =>
                          updateCavityDims(selectedCavity.id, {
                            cornerRadiusIn: snapInches(
                              Number(e.target.value),
                            ),
                          })
                        }
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCenterSelectedCavity}
                  className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50/40 transition"
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

      const label = c.label ?? `${c.lengthIn}×${c.widthIn}×${c.depthIn}"`;

      if (c.shape === "circle") {
        const r = Math.min(cavW, cavH) / 2;
        const cx = x + cavW / 2;
        const cy = y + cavH / 2;
        return `
  <g>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(
          2,
        )}" r="${r.toFixed(2)}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(
          2,
        )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${label}</text>
  </g>`;
      }

      return `
  <g>
    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}"
          width="${cavW.toFixed(2)}" height="${cavH.toFixed(2)}"
          rx="${(c.cornerRadiusIn ? c.cornerRadiusIn * scale : 0).toFixed(2)}"
          ry="${(c.cornerRadiusIn ? c.cornerRadiusIn * scale : 0).toFixed(2)}"
          fill="none" stroke="#111827" stroke-width="1" />
    <text x="${(x + cavW / 2).toFixed(2)}" y="${(y + cavH / 2).toFixed(
        2,
      )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${label}</text>
  </g>`;
    })
    .join("\n");

  const VIEW_W_STR = VIEW_W.toString();
  const VIEW_H_STR = VIEW_H.toString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W_STR}" height="${VIEW_H_STR}" viewBox="0 0 ${VIEW_W_STR} ${VIEW_H_STR}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(
    2,
  )}"
        width="${blockW.toFixed(2)}" height="${blockH.toFixed(
    2,
  )}"
        fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />
${cavRects}
</svg>`;
}
