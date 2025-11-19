// app/quote/layout/page.tsx
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

function formatBlockLabel(block: {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
}): string {
  const { lengthIn, widthIn, thicknessIn } = block;
  return `${lengthIn} × ${widthIn} × ${thicknessIn || 0}" block`;
}

function formatCavityLegendLabel(
  cav: {
    label: string;
    lengthIn: number;
    widthIn: number;
    depthIn: number;
  },
  index: number
): { chip: string; text: string; footprint: string } {
  const chip = `C${index + 1}`;
  const text = cav.label || `${cav.lengthIn}×${cav.widthIn}×${cav.depthIn}"`;
  const footprint = `${cav.lengthIn}" × ${cav.widthIn}" footprint`;
  return { chip, text, footprint };
}

type PaletteItem = {
  id: string;
  label: string;
  description: string;
  shape: CavityShape;
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  cornerRadiusIn?: number;
};

// Shape-based palette: square, rectangle, circle, rounded rectangle
const CAVITY_PALETTE: PaletteItem[] = [
  {
    id: "square",
    label: "Square",
    description: `Square pocket (3" × 3")`,
    shape: "rect",
    lengthIn: 3,
    widthIn: 3,
    depthIn: 1,
  },
  {
    id: "rect",
    label: "Rectangle",
    description: `Rectangular pocket (4" × 2")`,
    shape: "rect",
    lengthIn: 4,
    widthIn: 2,
    depthIn: 1,
  },
  {
    id: "circle",
    label: "Circle",
    description: `Round pocket (3" ø)`,
    shape: "circle",
    lengthIn: 3,
    widthIn: 3,
    depthIn: 1,
  },
  {
    id: "roundRect",
    label: "Rounded rectangle",
    description: `Rounded corners (4" × 3", 0.5" R)`,
    shape: "roundRect",
    lengthIn: 4,
    widthIn: 3,
    depthIn: 1,
    cornerRadiusIn: 0.5,
  },
];

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
    addCavity,
    deleteCavity,
    updateCavityFields,
  } = useLayoutModel(baseLayout);

  const quoteNo =
    quoteNoParam && quoteNoParam.trim().length > 0
      ? quoteNoParam.trim()
      : "Q-AI-EXAMPLE";

  const block = layout.block;
  const cavities = layout.cavities;

  const handlePaletteClick = (item: PaletteItem) => {
    addCavity({
      lengthIn: item.lengthIn,
      widthIn: item.widthIn,
      depthIn: item.depthIn,
      label: item.label,
      shape: item.shape,
      cornerRadiusIn: item.cornerRadiusIn ?? 0,
    });
  };

  const handleNumericChange = (
    id: string,
    field: "lengthIn" | "widthIn" | "depthIn" | "cornerRadiusIn",
    rawValue: string
  ) => {
    const parsed = Number(rawValue);
    if (Number.isNaN(parsed)) return;
    updateCavityFields(id, { [field]: parsed } as any);
  };

  const handleShapeChange = (id: string, shape: CavityShape) => {
    updateCavityFields(id, { shape });
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-200">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
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
              Block {formatBlockLabel(block)}
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Drag cavities in the preview to experiment with spacing and
            placement. Resize with the corner handle. Sizes snap to 1/8" and a
            0.5" wall is kept clear around the block.
          </div>
        </div>

        {/* 3-column layout on desktop: palette | canvas | cavity list */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr),minmax(0,2fr),minmax(0,1.4fr)] items-start">
          {/* Left: shape palette */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Cavity palette
              </div>
              <p className="text-[11px] text-slate-500 mb-2">
                Pick a shape to drop a new cavity into the layout. You can then
                drag it, resize it, and fine-tune the dimensions on the right.
              </p>
              <div className="flex flex-col gap-2">
                {CAVITY_PALETTE.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handlePaletteClick(item)}
                    className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl border border-indigo-100 bg-white text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition"
                  >
                    <div>
                      <div className="text-[11px] font-semibold text-indigo-800">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {item.description}
                      </div>
                    </div>
                    <span className="text-[11px] text-indigo-700 font-mono">
                      + Add
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 border-t border-slate-200 pt-3">
              <div className="text-[10px] text-slate-500 leading-snug">
                Future step: this same layout data can be exported as a simple
                DXF (polylines for block + cavities) so engineering can pull it
                into CAD as a starting point for tooling and nesting.
              </div>
            </div>
          </div>

          {/* Center: Interactive preview */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-600 mb-2 flex items-center justify-between">
              <span>Top view (scaled to block L × W)</span>
              <span className="font-mono text-[11px] text-slate-500">
                {block.lengthIn}" × {block.widthIn}" •{" "}
                {block.thicknessIn || 0}" thick
              </span>
            </div>

            <InteractiveCanvas
              layout={layout}
              selectedId={selectedId}
              selectAction={selectCavity}
              moveAction={updateCavityPosition}
            />

            <p className="mt-3 text-[11px] text-slate-500 leading-snug">
              Cavities are sized by their length and width relative to the block
              and can be dragged around inside the footprint. Depth and corner
              radius are shown on the right for each cavity.
            </p>
          </div>

          {/* Right: Cavities list with numeric inputs */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-4">
            {/* Block info */}
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Block
              </div>
              <div className="text-xs text-slate-600">
                {formatBlockLabel(block)}{" "}
                {block.thicknessIn ? (
                  <span className="text-slate-500">
                    (thickness is used for depth context, not in top-view
                    scaling)
                  </span>
                ) : null}
              </div>
            </div>

            {/* Cavities list */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold text-slate-700">
                  Cavities
                </div>
                <div className="text-[10px] text-slate-500">
                  Length / width / depth editable; size snaps to 0.125".
                </div>
              </div>

              {cavities.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No cavity data yet. Use the shape palette on the left or
                  include{" "}
                  <code className="font-mono text-[11px] bg-slate-200/70 px-1 py-0.5 rounded">
                    &cavities=3x2x1;2x2x1
                  </code>{" "}
                  in the URL to seed from an email/sketch.
                </div>
              ) : (
                <ul className="space-y-2">
                  {cavities.map((cav, idx) => {
                    const { chip, text, footprint } =
                      formatCavityLegendLabel(cav, idx);

                    const isSelected = cav.id === selectedId;

                    return (
                      <li
                        key={cav.id}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs flex flex-col gap-2"
                      >
                        {/* Header row: chip + label + delete */}
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              isSelected
                                ? selectCavity(null)
                                : selectCavity(cav.id)
                            }
                            className="flex items-center gap-2"
                          >
                            <span
                              className={[
                                "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
                                isSelected
                                  ? "bg-indigo-600 text-white"
                                  : "bg-indigo-100 text-indigo-700",
                              ].join(" ")}
                            >
                              {chip}
                            </span>
                            <span
                              className={
                                isSelected
                                  ? "text-slate-900 font-medium"
                                  : "text-slate-700"
                              }
                            >
                              {text}
                            </span>
                          </button>
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] text-slate-500">
                              {footprint}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteCavity(cav.id)}
                              className="text-[10px] text-rose-600 hover:text-rose-700 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {/* Shape & numeric controls */}
                        <div className="grid grid-cols-2 gap-2">
                          {/* Shape select */}
                          <div className="col-span-2">
                            <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                              Shape
                              <select
                                value={cav.shape}
                                onChange={(e) =>
                                  handleShapeChange(
                                    cav.id,
                                    e.target.value as CavityShape
                                  )
                                }
                                className="mt-0.5 h-6 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-800"
                              >
                                <option value="rect">Rect / square</option>
                                <option value="roundRect">
                                  Rounded rectangle
                                </option>
                                <option value="circle">Circle</option>
                              </select>
                            </label>
                          </div>

                          {/* Length */}
                          <div>
                            <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                              Length (L")
                              <input
                                type="number"
                                step={0.125}
                                min={0.25}
                                value={cav.lengthIn}
                                onChange={(e) =>
                                  handleNumericChange(
                                    cav.id,
                                    "lengthIn",
                                    e.target.value
                                  )
                                }
                                className="mt-0.5 h-6 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-800"
                              />
                            </label>
                          </div>

                          {/* Width */}
                          <div>
                            <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                              Width (W")
                              <input
                                type="number"
                                step={0.125}
                                min={0.25}
                                value={cav.widthIn}
                                onChange={(e) =>
                                  handleNumericChange(
                                    cav.id,
                                    "widthIn",
                                    e.target.value
                                  )
                                }
                                className="mt-0.5 h-6 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-800"
                              />
                            </label>
                          </div>

                          {/* Depth */}
                          <div>
                            <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                              Depth (D")
                              <input
                                type="number"
                                step={0.125}
                                min={0}
                                value={cav.depthIn}
                                onChange={(e) =>
                                  handleNumericChange(
                                    cav.id,
                                    "depthIn",
                                    e.target.value
                                  )
                                }
                                className="mt-0.5 h-6 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-800"
                              />
                            </label>
                          </div>

                          {/* Corner radius (for rounded rects) */}
                          <div>
                            <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                              Corner R"
                              <input
                                type="number"
                                step={0.125}
                                min={0}
                                value={cav.cornerRadiusIn ?? 0}
                                onChange={(e) =>
                                  handleNumericChange(
                                    cav.id,
                                    "cornerRadiusIn",
                                    e.target.value
                                  )
                                }
                                className="mt-0.5 h-6 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-800"
                              />
                            </label>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-2 border-t border-slate-200 pt-3">
              <div className="text-[11px] text-slate-500 leading-snug">
                This preview is a simplified layout meant for quick
                visualization. Your CNC / tooling layout may adjust exact
                spacing and orientation, but this will be perfect to feed into a
                future DXF exporter so engineering gets a clean starting sketch
                straight from the quote.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
