// app/quote/layout/page.tsx
"use client";

import * as React from "react";

import { buildLayoutFromStrings } from "./editor/layoutTypes";
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
  cav: { label: string; lengthIn: number; widthIn: number; depthIn: number },
  index: number
): { chip: string; text: string; footprint: string } {
  const chip = `C${index + 1}`;
  const text = cav.label || `${cav.lengthIn}×${cav.widthIn}×${cav.depthIn}"`;
  const footprint = `${cav.lengthIn}" × ${cav.widthIn}" footprint`;
  return { chip, text, footprint };
}

// Simple palette of common cavity sizes
const CAVITY_PALETTE = [
  { label: '2" × 2" × 1"', lengthIn: 2, widthIn: 2, depthIn: 1 },
  { label: '3" × 2" × 1"', lengthIn: 3, widthIn: 2, depthIn: 1 },
  { label: '4" × 3" × 1.5"', lengthIn: 4, widthIn: 3, depthIn: 1.5 },
  { label: '6" × 4" × 2"', lengthIn: 6, widthIn: 4, depthIn: 2 },
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
  } = useLayoutModel(baseLayout);

  const quoteNo =
    quoteNoParam && quoteNoParam.trim().length > 0
      ? quoteNoParam.trim()
      : "Q-AI-EXAMPLE";

  const block = layout.block;
  const cavities = layout.cavities;

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-200">
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
            placement. Resize with the corner handle. Sizes snap to 1/8" for
            clean, repeatable setups.
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr),minmax(0,1.2fr)] items-start">
          {/* Interactive preview */}
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
              and can be dragged around inside the footprint. Depth is shown in
              the legend on the right.
            </p>
          </div>

          {/* Legend / details + palette */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-4">
            {/* Palette */}
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Cavity palette
              </div>
              <div className="flex flex-wrap gap-2">
                {CAVITY_PALETTE.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() =>
                      addCavity({
                        lengthIn: tpl.lengthIn,
                        widthIn: tpl.widthIn,
                        depthIn: tpl.depthIn,
                        label: tpl.label,
                      })
                    }
                    className="px-2 py-1 rounded-full border border-indigo-200 bg-white text-[11px] text-indigo-700 hover:bg-indigo-50 transition"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Click a size to drop a new cavity into the layout. It will start
                centered in the block; drag and resize as needed.
              </p>
            </div>

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
                  Sizes snap to 0.125" when you resize.
                </div>
              </div>

              {cavities.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No cavity data yet. Use the palette above or include{" "}
                  <code className="font-mono text-[11px] bg-slate-200/70 px-1 py-0.5 rounded">
                    &cavities=3x2x1;2x2x1
                  </code>{" "}
                  in the URL to seed the layout from an email/sketch.
                </div>
              ) : (
                <ul className="space-y-1.5">
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
                spacing and orientation, but this gives the customer a clear,
                easy-to-understand picture of how their parts sit in the foam.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
