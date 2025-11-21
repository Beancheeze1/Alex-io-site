// app/quote/layout/page.tsx
//
// Layout editor host page (wide).
// - Left: palette
// - Center: large canvas
// - Right: block + cavity inspector + notes
// - Apply to quote posts layout + notes + SVG to /api/quote/layout/apply

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
  if (!raw || !raw.trim()) return "3x2x1; 2x2x1; 1x1x1";
  return raw.trim();
}

export default function LayoutPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const quoteNoParam = (searchParams?.quote_no ??
    searchParams?.quote ??
    "") as string | undefined;

  const dimsParam = (searchParams?.dims ??
    searchParams?.block ??
    "") as string | undefined;

  const cavitiesParam = (searchParams?.cavities ??
    searchParams?.cavity ??
    "") as string | undefined;

  const blockStr = normalizeDimsParam(dimsParam);
  const cavityStr = normalizeCavitiesParam(cavitiesParam);

  /* ---------- Build base model ---------- */

  const baseLayout = React.useMemo(() => {
    const fromQuery = buildLayoutFromStrings(blockStr, cavityStr);
    if (fromQuery) return fromQuery;

    return (
      buildLayoutFromStrings("10x10x2", "3x2x1;2x2x1;1x1x1") || {
        block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 },
        cavities: [],
      }
    );
  }, [blockStr, cavityStr]);

  const {
    layout,
    selectedId,
    selectCavity,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
  } = useLayoutModel(baseLayout);

  const [zoom, setZoom] = React.useState(1);
  const [notes, setNotes] = React.useState("");
  const [applyStatus, setApplyStatus] = React.useState<
    "idle" | "saving" | "done" | "error"
  >("idle");

  const quoteNo =
    quoteNoParam && quoteNoParam.trim().length > 0
      ? quoteNoParam.trim()
      : "Q-AI-EXAMPLE";

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

  /* ---------- Apply to quote ---------- */

  const handleApplyToQuote = async () => {
    try {
      setApplyStatus("saving");

      const svg = buildSvgFromLayout(layout);

      const res = await fetch("/api/quote/layout/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteNo,
          layout,
          notes,
          svg,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
        {/* ---------- LEFT: Cavity palette ---------- */}
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

          <div className="mt-3 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            Cavities snap to 0.125&quot; and keep 0.5&quot; walls to block
            edges and between pockets.
          </div>
        </aside>

        {/* ---------- CENTER: Big visualizer ---------- */}
        <section className="flex-1 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-900">
                <span className="font-semibold">Foam layout preview</span>
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
            </div>

            {/* zoom + apply button */}
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

              <button
                type="button"
                onClick={handleApplyToQuote}
                disabled={applyStatus === "saving"}
                className="inline-flex items-center rounded-full border border-slate-200 bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition disabled:opacity-60"
              >
                {applyStatus === "saving"
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

        {/* ---------- RIGHT: Inspector + notes ---------- */}
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
                  onChange={(e) =>
                    updateBlockDims({ lengthIn: Number(e.target.value) })
                  }
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">Width (in)</span>
                <input
                  type="number"
                  step={0.125}
                  value={block.widthIn}
                  onChange={(e) =>
                    updateBlockDims({ widthIn: Number(e.target.value) })
                  }
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">Thickness</span>
                <input
                  type="number"
                  step={0.125}
                  value={block.thicknessIn}
                  onChange={(e) =>
                    updateBlockDims({ thicknessIn: Number(e.target.value) })
                  }
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
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">Length (in)</span>
                  <input
                    type="number"
                    step={0.125}
                    value={selectedCavity.lengthIn}
                    onChange={(e) =>
                      updateCavityDims(selectedCavity.id, {
                        lengthIn: Number(e.target.value),
                      })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">Width (in)</span>
                  <input
                    type="number"
                    step={0.125}
                    value={selectedCavity.widthIn}
                    onChange={(e) =>
                      updateCavityDims(selectedCavity.id, {
                        widthIn: Number(e.target.value),
                      })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">Depth (in)</span>
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
                        cornerRadiusIn: Number(e.target.value),
                      })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Notes / special instructions */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Notes / special instructions
            </div>
            <div className="text-[11px] text-slate-500 mb-2">
              Optional text for anything the foam layout needs to call out (loose
              parts, labels, extra protection, etc.). This will be saved with the
              quote when you apply.
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs resize-vertical"
            />
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
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(
          2
        )}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(
          2
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
        2
      )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${label}</text>
  </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}"
        width="${blockW.toFixed(2)}" height="${blockH.toFixed(2)}"
        fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />
${cavRects}
</svg>`;
}
