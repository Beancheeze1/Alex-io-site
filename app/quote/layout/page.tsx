// app/quote/layout/page.tsx
//
// Foam layout preview + interactive editor.
// Left: cavity palette
// Center: interactive canvas
// Right: cavity inspector / numeric inputs.

"use client";

import * as React from "react";

import {
  buildLayoutFromStrings,
  Cavity,
  NewCavityInput,
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

function formatBlockLabel(block: {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
}): string {
  const { lengthIn, widthIn, thicknessIn } = block;
  return `${lengthIn} × ${widthIn} × ${thicknessIn || 0}" block`;
}

function formatCavityLegendLabel(
  cav: Cavity,
  index: number
): { chip: string; text: string; footprint: string } {
  const chip = `C${index + 1}`;
  const dimsText = `${cav.lengthIn}×${cav.widthIn}×${cav.depthIn}"`;
  const text = cav.label || dimsText;
  const footprint = `${cav.lengthIn}" × ${cav.widthIn}" footprint`;
  return { chip, text, footprint };
}

// Palette presets on the LEFT
const CAVITY_PRESETS: {
  id: string;
  name: string;
  description: string;
  preset: NewCavityInput;
}[] = [
  {
    id: "square",
    name: "Square",
    description: 'Square pocket (3" × 3" × 1")',
    preset: {
      lengthIn: 3,
      widthIn: 3,
      depthIn: 1,
      shape: "rect",
    },
  },
  {
    id: "rect",
    name: "Rectangle",
    description: 'Rectangular pocket (4" × 2" × 1")',
    preset: {
      lengthIn: 4,
      widthIn: 2,
      depthIn: 1,
      shape: "rect",
    },
  },
  {
    id: "rounded-rect",
    name: "Rounded rectangle",
    description: 'Rounded corners (4" × 3", 0.5" R)',
    preset: {
      lengthIn: 4,
      widthIn: 3,
      depthIn: 1,
      shape: "roundRect",
      cornerRadiusIn: 0.5,
    },
  },
  {
    id: "circle",
    name: "Circle",
    description: 'Round pocket (3" Ø × 1")',
    preset: {
      lengthIn: 3,
      widthIn: 3,
      depthIn: 1,
      shape: "circle",
    },
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
    updateCavitySize,
    updateCavityDepth,
    updateCavityCornerRadius,
    updateCavityLabel,
    updateCavityShape,
    addCavity,
    deleteCavity,
  } = useLayoutModel(baseLayout);

  const quoteNo =
    quoteNoParam && quoteNoParam.trim().length > 0
      ? quoteNoParam.trim()
      : "Q-AI-EXAMPLE";

  const block = layout.block;
  const cavities = layout.cavities;
  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  const handleNumericChange =
    (cav: Cavity, field: "length" | "width" | "depth" | "corner") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      if (!Number.isFinite(value)) return;

      if (field === "length") {
        updateCavitySize(cav.id, value, cav.widthIn);
      } else if (field === "width") {
        updateCavitySize(cav.id, cav.lengthIn, value);
      } else if (field === "depth") {
        updateCavityDepth(cav.id, value);
      } else if (field === "corner") {
        updateCavityCornerRadius(cav.id, value);
      }
    };

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-200">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-900">
              <span className="font-semibold">Foam layout editor</span>
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
          <div className="text-xs text-slate-500 md:text-right">
            Drag cavities in the center panel, use the handles to resize, or
            tweak exact inches on the right. The left palette lets you drop new
            cavities into the foam.
          </div>
        </div>

        {/* Main 3-column layout */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr),minmax(0,2.2fr),minmax(0,1.2fr)] items-start">
          {/* LEFT: Palette */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">
              Cavity palette
            </div>
            <div className="space-y-2">
              {CAVITY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addCavity(p.preset)}
                  className="w-full text-left rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-medium text-slate-800">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {p.description}
                      </div>
                    </div>
                    <span className="inline-flex items-center justify-center text-[11px] font-semibold px-2 py-1 rounded-full bg-indigo-600 text-white">
                      + Add
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500 leading-snug">
              Future step: this same layout data can be exported as a simple DXF
              (polylines for block + cavities) so engineering can pull it into
              CAD as a starting point for tooling and nesting.
            </p>
          </div>

          {/* CENTER: Interactive canvas */}
          <div>
            <div className="text-xs text-slate-600 mb-1 flex items-center justify-between">
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
              resizeAction={updateCavitySize}
            />
            <p className="mt-3 text-[11px] text-slate-500 leading-snug">
              Cavities are sized by their length and width relative to the block
              and can be dragged around inside the footprint. Depth is shown in
              the inspector on the right. All sizes snap to 0.125" increments.
            </p>
          </div>

          {/* RIGHT: Inspector / details */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-4">
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

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Cavities
              </div>
              {cavities.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No cavity data yet. Use the palette on the left or include{" "}
                  <code className="font-mono text-[11px] bg-slate-200/70 px-1 py-0.5 rounded">
                    &cavities=3x2x1;2x2x1
                  </code>{" "}
                  in the URL to seed from the email.
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-40 overflow-auto pr-1">
                  {cavities.map((cav, idx) => {
                    const { chip, text, footprint } =
                      formatCavityLegendLabel(cav, idx);

                    const isSelected = cav.id === selectedId;

                    return (
                      <li
                        key={cav.id}
                        className="flex items-start justify-between gap-2 text-xs"
                      >
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
                        <span className="text-[11px] text-slate-500 whitespace-nowrap">
                          {footprint}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Inspector for selected cavity */}
            <div className="mt-2 border-t border-slate-200 pt-3">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Cavity details
              </div>
              {!selectedCavity ? (
                <p className="text-[11px] text-slate-500">
                  Select a cavity from the list above or by clicking it in the
                  preview to edit its exact dimensions.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Label
                      </label>
                      <input
                        type="text"
                        defaultValue={selectedCavity.label}
                        onBlur={(e) =>
                          updateCavityLabel(
                            selectedCavity.id,
                            e.target.value || selectedCavity.label
                          )
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Length (L)
                        </label>
                        <input
                          type="number"
                          step={0.125}
                          value={selectedCavity.lengthIn}
                          onChange={handleNumericChange(
                            selectedCavity,
                            "length"
                          )}
                          className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Width (W)
                        </label>
                        <input
                          type="number"
                          step={0.125}
                          value={selectedCavity.widthIn}
                          onChange={handleNumericChange(
                            selectedCavity,
                            "width"
                          )}
                          className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Depth
                        </label>
                        <input
                          type="number"
                          step={0.125}
                          value={selectedCavity.depthIn}
                          onChange={handleNumericChange(
                            selectedCavity,
                            "depth"
                          )}
                          className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1.4fr),minmax(0,1fr)] gap-2 items-end">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Shape
                        </label>
                        <select
                          value={selectedCavity.shape}
                          onChange={(e) =>
                            updateCavityShape(
                              selectedCavity.id,
                              e.target.value as any
                            )
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="rect">Rectangle / square</option>
                          <option value="roundRect">
                            Rounded rectangle / square
                          </option>
                          <option value="circle">Circle</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Corner radius
                        </label>
                        <input
                          type="number"
                          step={0.125}
                          value={selectedCavity.cornerRadiusIn}
                          onChange={handleNumericChange(
                            selectedCavity,
                            "corner"
                          )}
                          className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] text-slate-500">
                        This cavity obeys the 0.5" wall margin and snaps to
                        0.125" increments for length, width, and depth.
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteCavity(selectedCavity.id)}
                        className="ml-2 inline-flex items-center px-2 py-1 rounded-full border border-rose-300 text-[11px] font-medium text-rose-700 bg-rose-50 hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
