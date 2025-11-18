"use client";

import * as React from "react";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

type ParsedDims = {
  L: number;
  W: number;
  H: number;
};

type Cavity = {
  id: string;
  label: string; // "C1"
  dimsRaw: string; // "3x2x1"
  L: number;
  W: number;
  H: number;
};

function parseDims(str: string | null | undefined): ParsedDims | null {
  if (!str) return null;
  const cleaned = str.toLowerCase().replace(/"/g, "").replace(/×/g, "x");
  const parts = cleaned.split("x").map((s) => Number(s.trim()));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n) || n <= 0)) {
    return null;
  }
  return {
    L: parts[0] || 0,
    W: parts[1] || 0,
    H: parts[2] || 0,
  };
}

function parseCavities(raw: string | null | undefined): Cavity[] {
  if (!raw) return [];
  const sep = raw.replace(/\|/g, ";").replace(/,/g, ";");
  const tokens = sep.split(";").map((s) => s.trim()).filter(Boolean);

  const out: Cavity[] = [];
  tokens.forEach((tok, idx) => {
    const cleaned = tok.toLowerCase().replace(/"/g, "").replace(/×/g, "x");
    const parts = cleaned.split("x").map((s) => Number(s.trim()));
    if (parts.length < 2 || parts.some((n) => Number.isNaN(n) || n <= 0)) {
      return;
    }
    const L = parts[0] || 0;
    const W = parts[1] || 0;
    const H = parts[2] || 0;
    out.push({
      id: `cav-${idx}`,
      label: `C${idx + 1}`,
      dimsRaw: tok,
      L,
      W,
      H,
    });
  });

  return out;
}

function formatDimsLabel(d: ParsedDims | null): string {
  if (!d) return "—";
  return `${d.L} × ${d.W} × ${d.H || 0}" block`;
}

function formatCavityLabel(c: Cavity): string {
  const parts = c.dimsRaw.replace(/"/g, "").trim();
  return `${c.label} – ${parts}"`;
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

  // Fallback demo values if nothing is passed
  const dims =
    parseDims(dimsParam) ?? parseDims("10x10x2") ?? { L: 10, W: 10, H: 2 };
  const cavities = (() => {
    const parsed = parseCavities(cavitiesParam);
    if (parsed.length > 0) return parsed;
    return parseCavities("3x2x1; 2x2x1; 1x1x1");
  })();

  const quoteNo = quoteNoParam && quoteNoParam.trim().length > 0
    ? quoteNoParam.trim()
    : "Q-AI-EXAMPLE";

  // SVG layout constants
  const VIEW_W = 480;
  const VIEW_H = 320;
  const PADDING = 32;

  // Determine block aspect ratio using L (X) and W (Y)
  const innerW = VIEW_W - PADDING * 2;
  const innerH = VIEW_H - PADDING * 2;

  const blockAspect = dims.L / (dims.W || 1);
  let blockPixelW = innerW;
  let blockPixelH = innerH;

  if (blockAspect >= 1) {
    blockPixelW = innerW;
    blockPixelH = innerW / blockAspect;
    if (blockPixelH > innerH) {
      blockPixelH = innerH;
      blockPixelW = innerH * blockAspect;
    }
  } else {
    blockPixelH = innerH;
    blockPixelW = innerH * blockAspect;
    if (blockPixelW > innerW) {
      blockPixelW = innerW;
      blockPixelH = innerW / blockAspect;
    }
  }

  const blockX = (VIEW_W - blockPixelW) / 2;
  const blockY = (VIEW_H - blockPixelH) / 2;

  // Scale factors: physical inches -> pixels
  const scaleX = blockPixelW / (dims.L || 1);
  const scaleY = blockPixelH / (dims.W || 1);

  // Lay cavities out in a simple grid with equal spacing
  const cavitiesWithLayout = React.useMemo(() => {
    if (cavities.length === 0) return [];

    const n = cavities.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);

    const cellW = blockPixelW / cols;
    const cellH = blockPixelH / rows;

    return cavities.map((cav, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;

      // Desired physical size in pixels
      const cavPxW = Math.min(cav.L * scaleX, cellW * 0.8);
      const cavPxH = Math.min(cav.W * scaleY, cellH * 0.8);

      // Center in the grid cell
      const cellCenterX = blockX + col * cellW + cellW / 2;
      const cellCenterY = blockY + row * cellH + cellH / 2;

      const x = cellCenterX - cavPxW / 2;
      const y = cellCenterY - cavPxH / 2;

      return {
        ...cav,
        x,
        y,
        pixelW: cavPxW,
        pixelH: cavPxH,
      };
    });
  }, [cavities, blockPixelW, blockPixelH, blockX, blockY, scaleX, scaleY]);

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-200">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-900">
              <span className="font-semibold">
                Foam layout preview
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
              Block {formatDimsLabel(dims)}
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Drag is coming soon — for now this keeps cavities centered and evenly spaced
            based on their sizes.
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr),minmax(0,1.2fr)] items-start">
          {/* SVG preview */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-600 mb-2 flex items-center justify-between">
              <span>Top view (scaled to block L × W)</span>
              <span className="font-mono text-[11px] text-slate-500">
                {dims.L}" × {dims.W}" • {dims.H || 0}" thick
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center">
              <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                className="w-full h-[260px] md:h-[300px]"
              >
                {/* Block */}
                <rect
                  x={blockX}
                  y={blockY}
                  width={blockPixelW}
                  height={blockPixelH}
                  rx={12}
                  ry={12}
                  fill="#e0edff"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                />
                {/* Block label */}
                <text
                  x={blockX + blockPixelW / 2}
                  y={blockY + 16}
                  textAnchor="middle"
                  fill="#1f2933"
                  fontSize={11}
                  fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                >
                  Block {dims.L} × {dims.W} × {dims.H || 0}"
                </text>

                {/* Cavities */}
                {cavitiesWithLayout.map((c) => (
                  <g key={c.id}>
                    <rect
                      x={c.x}
                      y={c.y}
                      width={c.pixelW}
                      height={c.pixelH}
                      rx={6}
                      ry={6}
                      fill="#ffffff"
                      stroke="#1f2937"
                      strokeWidth={1.2}
                    />
                    {/* cavity label inside */}
                    <text
                      x={c.x + c.pixelW / 2}
                      y={c.y + c.pixelH / 2 + 4}
                      textAnchor="middle"
                      fill="#111827"
                      fontSize={10}
                      fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                    >
                      {c.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <p className="mt-3 text-[11px] text-slate-500 leading-snug">
              Cavities are scaled by their length and width relative to the block and
              laid out in a simple grid so they stay centered and nicely spaced.
              Depth is shown in the legend on the right.
            </p>
          </div>

          {/* Legend / details */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Block
              </div>
              <div className="text-xs text-slate-600">
                {formatDimsLabel(dims)}{" "}
                {dims.H ? (
                  <span className="text-slate-500">
                    (approximate thickness for depth, not used in top-view scale)
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">
                Cavities
              </div>
              {cavitiesWithLayout.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No cavity data was passed in. If you include{" "}
                  <code className="font-mono text-[11px] bg-slate-200/70 px-1 py-0.5 rounded">
                    &cavities=3x2x1;2x2x1
                  </code>{" "}
                  in the URL, those cavities will be shown here.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {cavitiesWithLayout.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold">
                          {c.label}
                        </span>
                        <span className="text-slate-700">
                          {formatCavityLabel(c)}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {c.L}" × {c.W}" footprint
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-2 border-t border-slate-200 pt-3">
              <div className="text-[11px] text-slate-500 leading-snug">
                This preview is a simplified layout meant for quick visualization.
                Your CNC / tooling layout may adjust exact spacing and orientation,
                but this gives the customer a clear, easy-to-understand picture of
                how their parts sit in the foam.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
