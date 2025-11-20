// app/quote/layout/page.tsx
//
// Layout editor host page.
// Horizontal 3-pane layout:
//   [ left: palette ] [ center: big visualizer ] [ right: block + cavity inspector ]
//
// Also includes:
//   - Editable block size (L/W/T)
//   - Editable cavity dims & depth
//   - Zoom slider for the center canvas
//   - "Export SVG" button (simple top-view SVG built from layout data)

"use client";

import * as React from "react";

import { buildLayoutFromStrings, CavityShape } from "./editor/layoutTypes";
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

  // Build base layout model from query params (with safe fallback)
  const baseLayout = React.useMemo(() => {
    const fromQuery = buildLayoutFromStrings(blockStr, cavityStr);
    if (fromQuery) return fromQuery;

    // Hard fallback if parsing fails
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
    addCavityAt, // for drag-from-palette
    deleteCavity,
  } = useLayoutModel(baseLayout);

  const [zoom, setZoom] = React.useState(1);

  const quoteNo =
    quoteNoParam && quoteNoParam.trim().length > 0
      ? quoteNoParam.trim()
      : "Q-AI-EXAMPLE";

  const { block, cavities } = layout;
  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  /* ---------- Palette helpers ---------- */

  const handleAddPreset = (shape: CavityShape) => {
    // Simple presets; user can edit dims afterwards on the right.
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

  // Shared dragStart helper for palette buttons
  const handlePaletteDragStart = (
    e: React.DragEvent<HTMLButtonElement>,
    payload: {
      shape: CavityShape;
      lengthIn: number;
      widthIn: number;
      depthIn: number;
      cornerRadiusIn?: number;
    }
  ) => {
    try {
      e.dataTransfer.setData(
        "application/x-cavity",
        JSON.stringify(payload)
      );
      e.dataTransfer.effectAllowed = "copyMove";
    } catch {
      // Fallback: click-to-add still works
    }
  };

  /* ---------- Export as SVG ---------- */

  const handleExportSvg = () => {
    const svg = buildSvgFromLayout(layout);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `foam-layout-${quoteNo}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-stretch px-4 py-6">
      <div className="w-full max-w-6xl mx-auto bg-white rounded-2xl shadow-xl border border-slate-200 flex flex-row gap-4 p-4">
        {/* ---------- LEFT: cavity palette ---------- */}
        <aside className="w-52 shrink-0 flex flex-col gap-3 border-r border-slate-200 pr-3">
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Cavity palette
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              Click a style to add a new pocket, or drag it directly into the
              block and drop it where you want it.
            </p>
          </div>

          {/* Rectangle preset */}
          <button
            type="button"
            onClick={() => handleAddPreset("rect")}
            draggable
            onDragStart={(e) =>
              handlePaletteDragStart(e, {
                shape: "rect",
                lengthIn: 4,
                widthIn: 2,
                depthIn: 2,
              })
            }
            className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50/50 transition cursor-move"
          >
            <div className="font-semibold text-slate-800">Rectangle</div>
            <div className="text-[11px] text-slate-500">
              Rectangular pocket (4&quot; × 2&quot;)
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              Drag into block or click to add
            </div>
          </button>

          {/* Circle preset */}
          <button
            type="button"
            onClick={() => handleAddPreset("circle")}
            draggable
            onDragStart={(e) =>
              handlePaletteDragStart(e, {
                shape: "circle",
                lengthIn: 3,
                widthIn: 3,
                depthIn: 2,
              })
            }
            className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50/50 transition cursor-move"
          >
            <div className="font-semibold text-slate-800">Circle</div>
            <div className="text-[11px] text-slate-500">
              Round pocket (3&quot; Ø)
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              Drag into block or click to add
            </div>
          </button>

          {/* Rounded rectangle preset */}
          <button
            type="button"
            onClick={() => handleAddPreset("roundedRect")}
            draggable
            onDragStart={(e) =>
              handlePaletteDragStart(e, {
                shape: "roundedRect",
                lengthIn: 4,
                widthIn: 3,
                depthIn: 2,
                cornerRadiusIn: 0.5,
              })
            }
            className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50/50 transition cursor-move"
          >
            <div className="font-semibold text-slate-800">
              Rounded rectangle
            </div>
            <div className="text-[11px] text-slate-500">
              Rounded corners (4&quot; × 3&quot;, 0.5&quot; R)
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              Drag into block or click to add
            </div>
          </button>

          <div className="mt-3 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            Drag any preset into the block to place it roughly where you want
            it, then fine-tune size and location in the center and on the right.
          </div>
        </aside>

        {/* ---------- CENTER: big visualizer ---------- */}
        <section className="flex-1 flex flex-col gap-3">
          {/* header */}
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
                {block.lengthIn}" × {block.widthIn}" × {block.thicknessIn || 0}
                " block
              </div>
            </div>

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
                  className="w-24"
                />
              </div>
              <button
                type="button"
                onClick={handleExportSvg}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 transition"
              >
                Export SVG
              </button>
            </div>
          </div>

          <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 p-4 overflow-auto">
            <div className="text-xs text-slate-600 mb-2 flex items-center justify-between">
              <span>Top view (scaled to block L × W)</span>
              <span className="font-mono text-[11px] text-slate-500">
                {block.lengthIn}" × {block.widthIn}" •{" "}
                {block.thicknessIn || 0}" thick
              </span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center">
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center", // zoom from the center of the block
                }}
                className="transition-transform"
              >
                <InteractiveCanvas
                  layout={layout}
                  selectedId={selectedId}
                  selectAction={selectCavity}
                  moveAction={updateCavityPosition}
                  // Wrap updateCavityDims to match resizeAction signature
                  resizeAction={(id, lengthIn, widthIn) =>
                    updateCavityDims(id, { lengthIn, widthIn })
                  }
                  // enable drag-from-palette
                  addCavityAtAction={addCavityAt}
                />
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-500 leading-snug">
              Cavities are sized by their length and width (or diameter for
              circles) relative to the block and can be dragged around inside
              the footprint. Depth and corner radius are shown and editable on
              the right. A 0.5&quot; wall is kept clear around the block so
              pockets don&apos;t get too close to the edge. You can add new
              cavities either by clicking a preset or dragging it from the
              palette into the block.
            </p>
          </div>
        </section>

        {/* ---------- RIGHT: block + cavity inspector ---------- */}
        <aside className="w-64 shrink-0 flex flex-col gap-3 border-l border-slate-200 pl-3">
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

          {/* Cavity list + editor */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3 flex-1 flex flex-col">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Cavities
            </div>

            {cavities.length === 0 ? (
              <div className="text-xs text-slate-500">
                No cavities yet. Use the palette on the left to add a pocket.
              </div>
            ) : (
              <ul className="space-y-1.5 mb-3 max-h-32 overflow-auto">
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
                  Editing{" "}
                  <strong>
                    {selectedCavity.shape === "circle"
                      ? `Ø${selectedCavity.lengthIn}×${selectedCavity.depthIn}"`
                      : `${selectedCavity.lengthIn}×${selectedCavity.widthIn}×${selectedCavity.depthIn}"`}
                  </strong>
                </span>
              ) : (
                <span>Select a cavity above to edit its size and depth.</span>
              )}
            </div>

            {selectedCavity && (
              <>
                {selectedCavity.shape === "circle" ? (
                  // Circle editor: diameter + depth
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-[11px] text-slate-500">
                        Diameter (in)
                      </span>
                      <input
                        type="number"
                        step={0.125}
                        value={selectedCavity.lengthIn}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v)) {
                            updateCavityDims(selectedCavity.id, {
                              lengthIn: v,
                              widthIn: v,
                            });
                          }
                        }}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1 col-span-2">
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
                  // Rect / roundedRect editor: length, width, depth, (optional radius)
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
                            lengthIn: Number(e.target.value),
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
                            widthIn: Number(e.target.value),
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
                    {selectedCavity.shape === "roundedRect" && (
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
                    )}
                  </div>
                )}
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
  layout: ReturnType<typeof buildLayoutFromStrings> extends infer T
    ? T extends { block: any; cavities: any[] }
      ? T
      : never
    : never
): string {
  // Because TS can’t infer nicely from the helper above, we just treat
  // layout as `any` here; the runtime structure is guaranteed by our hook.
  const l = layout as any;
  const block = l.block as { lengthIn: number; widthIn: number };
  const cavities = (l.cavities as any[]) || [];

  const VIEW_W = 800;
  const VIEW_H = 600;
  const PADDING = 40;

  const scaleX = (VIEW_W - 2 * PADDING) / block.lengthIn;
  const scaleY = (VIEW_H - 2 * PADDING) / block.widthIn;
  const scale = Math.min(scaleX, scaleY);

  const blockW = block.lengthIn * scale;
  const blockH = block.widthIn * scale;
  const blockX = (VIEW_W - blockW) / 2;
  const blockY = (VIEW_H - blockH) / 2;

  const cavRects = cavities
    .map((c: any) => {
      const cavW = c.lengthIn * scale;
      const cavH = c.widthIn * scale;
      const x = blockX + c.x * blockW;
      const y = blockY + c.y * blockH;

      const label = c.label ?? `${c.lengthIn}×${c.widthIn}×${c.depthIn}"`;

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
