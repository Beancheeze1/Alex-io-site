// app/quote/layout/page.tsx
"use client";

import * as React from "react";

import {
  buildLayoutFromStrings,
  type CavityShape,
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
  cav: {
    id: string;
    label: string;
    lengthIn: number;
    widthIn: number;
    depthIn: number;
  },
  index: number
): { chip: string; text: string; footprint: string } {
  const chip = `C${index + 1}`;
  const text =
    cav.label ||
    `${cav.lengthIn}×${cav.widthIn}×${cav.depthIn}"`;
  const footprint = `${cav.lengthIn}" × ${cav.widthIn}" footprint`;
  return { chip, text, footprint };
}

const PALETTE: {
  shape: CavityShape;
  label: string;
  description: string;
}[] = [
  {
    shape: "rect",
    label: "Rectangle",
    description: 'Rectangular pocket (e.g. 4" × 2")',
  },
  {
    shape: "circle",
    label: "Circle",
    description: 'Round pocket (e.g. 3" Ø)',
  },
  {
    shape: "roundRect",
    label: "Rounded rectangle",
    description: 'Rounded corners (e.g. 4" × 3", 0.5" R)',
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
    updateCavityMeta,
    updateBlockSize,
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

  // Handlers
  const handleBlockInputChange =
    (field: "lengthIn" | "widthIn" | "thicknessIn") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      const lengthIn =
        field === "lengthIn" ? value : block.lengthIn;
      const widthIn =
        field === "widthIn" ? value : block.widthIn;
      const thicknessIn =
        field === "thicknessIn" ? value : block.thicknessIn;
      updateBlockSize(lengthIn, widthIn, thicknessIn);
    };

  const handleCavitySizeChange =
    (id: string, field: "lengthIn" | "widthIn") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      const cav = cavities.find((c) => c.id === id);
      if (!cav) return;
      const lengthIn =
        field === "lengthIn" ? value : cav.lengthIn;
      const widthIn =
        field === "widthIn" ? value : cav.widthIn;
      updateCavitySize(id, lengthIn, widthIn);
    };

  const handleCavityDepthChange =
    (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      updateCavityMeta(id, { depthIn: value });
    };

  const handleCavityRadiusChange =
    (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      updateCavityMeta(id, { cornerRadiusIn: value });
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
          <div className="text-xs text-slate-500 max-w-xs">
            Left: choose cavity shapes. Center: drag & resize cavities
            with snap-to-grid and 0.5&quot; wall. Right: fine-tune sizes,
            depth and corner radius.
          </div>
        </div>

        {/* 3-panel layout: palette | canvas | editor */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr),minmax(0,2.1fr),minmax(0,1.2fr)] items-start">
          {/* LEFT: Palette + block size */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Cavity palette
              </div>
              <div className="space-y-2">
                {PALETTE.map((item) => (
                  <button
                    key={item.shape}
                    type="button"
                    onClick={() => addCavity(item.shape)}
                    className="w-full text-left rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-indigo-400 hover:shadow-sm transition text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-indigo-600 font-semibold">
                        + Add
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {item.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Block size (editable)
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500">
                    Length (L, in)
                  </span>
                  <input
                    type="number"
                    step="0.125"
                    value={block.lengthIn}
                    onChange={handleBlockInputChange("lengthIn")}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500">
                    Width (W, in)
                  </span>
                  <input
                    type="number"
                    step="0.125"
                    value={block.widthIn}
                    onChange={handleBlockInputChange("widthIn")}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500">
                    Thick (T, in)
                  </span>
                  <input
                    type="number"
                    step="0.125"
                    value={block.thicknessIn}
                    onChange={handleBlockInputChange("thicknessIn")}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </label>
              </div>
              <p className="mt-2 text-[10px] text-slate-500 leading-snug">
                Changing the block size keeps a 0.5&quot; wall and
                re-clamps existing cavities so they stay inside.
              </p>
            </div>
          </div>

          {/* CENTER: Interactive preview */}
          <div>
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
                resizeAction={updateCavitySize}
              />

              <p className="mt-3 text-[11px] text-slate-500 leading-snug">
                Cavities are sized by their length and width relative to the
                block and can be dragged around inside the footprint. Depth is
                shown in the editor on the right.
              </p>
            </div>
          </div>

          {/* RIGHT: Cavity list + editor */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Cavities
              </div>
              {cavities.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No cavities yet. Use the palette on the left to add a
                  rectangle, circle, or rounded rectangle, then drag and
                  resize it in the preview.
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
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500">
                            {footprint}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteCavity(cav.id)}
                            className="text-[10px] text-rose-500 hover:text-rose-600"
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

            {/* Selected cavity editor */}
            {selectedCavity && (
              <div className="border-t border-slate-200 pt-3">
                <div className="text-xs font-semibold text-slate-700 mb-2">
                  Edit selected cavity
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500">
                      Length (L, in)
                    </span>
                    <input
                      type="number"
                      step="0.125"
                      value={selectedCavity.lengthIn}
                      onChange={handleCavitySizeChange(
                        selectedCavity.id,
                        "lengthIn"
                      )}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500">
                      Width (W, in)
                    </span>
                    <input
                      type="number"
                      step="0.125"
                      value={selectedCavity.widthIn}
                      onChange={handleCavitySizeChange(
                        selectedCavity.id,
                        "widthIn"
                      )}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500">
                      Depth (D, in)
                    </span>
                    <input
                      type="number"
                      step="0.125"
                      value={selectedCavity.depthIn}
                      onChange={handleCavityDepthChange(
                        selectedCavity.id
                      )}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>
                  {selectedCavity.shape === "roundRect" && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500">
                        Corner radius (R, in)
                      </span>
                      <input
                        type="number"
                        step="0.125"
                        value={selectedCavity.cornerRadiusIn ?? 0.5}
                        onChange={handleCavityRadiusChange(
                          selectedCavity.id
                        )}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">
                  Length and width snap to 0.125&quot; increments and
                  are clamped so the cavity stays inside the 0.5&quot;
                  wall. Depth and radius are for quoting / CAD notes
                  and don&apos;t change the top-view outline.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
