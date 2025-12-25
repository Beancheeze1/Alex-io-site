// app/lib/layout/exports.ts
//
// Server-side helpers to turn a LayoutModel-shaped object into:
//   - SVG (top view)
//   - DXF (simple 2D drawing – block + cavities)
//   - STEP (very minimal placeholder text for now)
//
// NOTE: We're keeping types loose here so we don't fight the app-side types.
//       The layout object is whatever the layout editor sends (LayoutModel).
//
// PATH A UPDATE (per-layer exports):
// - If layout.stack[] exists, we render ONE combined SVG + ONE combined DXF
//   containing a "panel" per layer, stacked vertically.
// - Each layer's block outline uses layer.cropCorners to decide square vs chamfer.
// - Cavities come from layer.cavities.
// - Legacy single-layer layouts (no stack) behave exactly as before.
// - STEP remains "" so we never overwrite the real STEP produced by the STEP microservice.

export type LayoutExportBundle = {
  svg: string;
  dxf: string;
  step: string;
};

type BlockLike = {
  lengthIn: number;
  widthIn: number;
  thicknessIn?: number | null;

  // Optional corner metadata (legacy behavior)
  cornerStyle?: string | null; // "square" | "chamfer"
  chamferIn?: number | null; // inches
};

type CavityLike = {
  id: string;
  shape: "rect" | "roundedRect" | "circle";
  x: number; // normalized 0–1 position from left
  y: number; // normalized 0–1 position from top
  lengthIn: number;
  widthIn: number;
  depthIn?: number | null;
  cornerRadiusIn?: number | null;
  label?: string | null;
};

type LayerLike = {
  id?: string | null;
  label?: string | null;
  thicknessIn?: number | null;
  cropCorners?: boolean | null;
  cavities?: CavityLike[] | null;
};

type LayoutLike = {
  block: BlockLike;
  cavities: CavityLike[];

  // Optional multi-layer stack (editor sends this)
  stack?: LayerLike[] | null;
};

const VIEW_W = 1000;
const VIEW_H_PER_LAYER = 700;
const PADDING = 40;
const LAYER_GAP_PX = 20;

// DXF spacing (inches) between stacked layer panels
const LAYER_GAP_IN = 2;

export function buildLayoutExports(layout: LayoutLike): LayoutExportBundle {
  const svg = buildSvg(layout);
  const dxf = buildDxf(layout);
  const step = buildStepStub(layout);
  return { svg, dxf, step };
}

/* ================= SVG ================= */

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clampFinite(n: any, fallback: number) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function deriveChamferIn(block: BlockLike): number {
  // We prefer the stored chamferIn.
  // If missing/invalid, return 0 so behavior stays square unless explicitly set.
  const raw = block?.chamferIn;
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildSvg(layout: LayoutLike): string {
  const block = layout?.block || ({} as any);

  const L = clampFinite(block.lengthIn, 0);
  const W = clampFinite(block.widthIn, 0);

  if (L <= 0 || W <= 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H_PER_LAYER}" viewBox="0 0 ${VIEW_W} ${VIEW_H_PER_LAYER}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  }

  const stack = Array.isArray((layout as any)?.stack) ? ((layout as any).stack as LayerLike[]) : null;

  // Legacy single-layer path (unchanged)
  if (!stack || stack.length === 0) {
    const cavities = Array.isArray(layout?.cavities) ? layout.cavities : [];
    const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
    const chamferIn = deriveChamferIn(block);

    const forceChamfer = cornerStyle === "chamfer" && chamferIn > 0;

    return buildSvgPanel({
      L,
      W,
      cavities,
      chamferIn: forceChamfer ? chamferIn : 0,
      title: null,
      panelY: 0,
      totalHeight: VIEW_H_PER_LAYER,
    });
  }

  // Per-layer combined SVG:
  // One "panel" per layer stacked vertically.
  const totalH = stack.length * VIEW_H_PER_LAYER + Math.max(0, stack.length - 1) * LAYER_GAP_PX;

  const panels = stack
    .map((layer, idx) => {
      const cavities = Array.isArray(layer?.cavities) ? (layer!.cavities as CavityLike[]) : [];
      const crop = !!layer?.cropCorners;

      // If cropCorners is true, use chamferIn from block (must be set somewhere).
      // If chamferIn is missing, we keep it square (Path A: no surprise geometry).
      const chamferIn = crop ? deriveChamferIn(block) : 0;

      const title =
        (typeof layer?.label === "string" && layer.label.trim().length > 0 ? layer.label.trim() : null) ??
        `Layer ${idx + 1}`;

      const panelY = idx * (VIEW_H_PER_LAYER + LAYER_GAP_PX);

      const panelSvg = buildSvgPanel({
        L,
        W,
        cavities,
        chamferIn,
        title,
        panelY,
        totalHeight: totalH,
      });

      // buildSvgPanel returns a full <svg>...; for stacking, we only want its inner content.
      // So buildSvgPanel() returns a group payload (see implementation).
      return panelSvg;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${totalH}" viewBox="0 0 ${VIEW_W} ${totalH}" xmlns="http://www.w3.org/2000/svg">
${panels}
</svg>`;
}

function buildSvgPanel(params: {
  L: number;
  W: number;
  cavities: CavityLike[];
  chamferIn: number; // 0 => square
  title: string | null;
  panelY: number;
  totalHeight: number;
}): string {
  const { L, W, cavities, chamferIn, title, panelY } = params;

  // Scale based on one panel height (VIEW_H_PER_LAYER)
  const scaleX = (VIEW_W - 2 * PADDING) / L;
  const scaleY = (VIEW_H_PER_LAYER - 2 * PADDING) / W;
  const scale = Math.min(scaleX, scaleY);

  const blockW = L * scale;
  const blockH = W * scale;
  const blockX = (VIEW_W - blockW) / 2;
  const blockY = panelY + (VIEW_H_PER_LAYER - blockH) / 2;

  const chamferPx = Number.isFinite(chamferIn) && chamferIn > 0 ? chamferIn * scale : 0;

  // Clamp chamfer so it can't exceed half the side
  const c = Math.max(0, Math.min(chamferPx, blockW / 2 - 0.01, blockH / 2 - 0.01));

  const blockOutline =
    c > 0.001
      ? (() => {
          const x0 = blockX;
          const y0 = blockY;
          const x1 = blockX + blockW;
          const y1 = blockY + blockH;

          // Two-corner chamfer (SVG coords: y grows downward):
          // - Top-left chamfer at (x0,y0)
          // - Bottom-right chamfer at (x1,y1)
          const d = [
            `M ${x0.toFixed(2)} ${(y0 + c).toFixed(2)}`,
            `L ${x0.toFixed(2)} ${y1.toFixed(2)}`,
            `L ${(x1 - c).toFixed(2)} ${y1.toFixed(2)}`,
            `L ${x1.toFixed(2)} ${(y1 - c).toFixed(2)}`,
            `L ${x1.toFixed(2)} ${y0.toFixed(2)}`,
            `L ${(x0 + c).toFixed(2)} ${y0.toFixed(2)}`,
            `Z`,
          ].join(" ");

          return `<path d="${d}" fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;
        })()
      : `<rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}"
        width="${blockW.toFixed(2)}" height="${blockH.toFixed(2)}"
        fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;

  const header =
    title && title.trim().length > 0
      ? `<text x="${PADDING}" y="${(panelY + 24).toFixed(2)}" font-size="14" fill="#111827">${escapeText(
          title,
        )}</text>`
      : "";

  const cavRects = (cavities || [])
    .map((cav) => {
      const cavW = clampFinite(cav.lengthIn, 0) * scale;
      const cavH = clampFinite(cav.widthIn, 0) * scale;
      const x = blockX + clampFinite(cav.x, 0) * blockW;
      const y = blockY + clampFinite(cav.y, 0) * blockH;

      const label =
        cav.label ??
        (cav.shape === "circle"
          ? `Ø${cav.lengthIn}×${cav.depthIn ?? ""}"`.trim()
          : `${cav.lengthIn}×${cav.widthIn}×${cav.depthIn ?? ""}"`.trim());

      if (cav.shape === "circle") {
        const r = Math.min(cavW, cavH) / 2;
        const cx = x + cavW / 2;
        const cy = y + cavH / 2;
        return `
  <g>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(
          2,
        )}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(
          2,
        )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${escapeText(label)}</text>
  </g>`;
      }

      const rx = cav.cornerRadiusIn ? clampFinite(cav.cornerRadiusIn, 0) * scale : 0;
      const rxy = Number.isFinite(rx) ? rx : 0;

      return `
  <g>
    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}"
          width="${cavW.toFixed(2)}" height="${cavH.toFixed(2)}"
          rx="${rxy.toFixed(2)}"
          ry="${rxy.toFixed(2)}"
          fill="none" stroke="#111827" stroke-width="1" />
    <text x="${(x + cavW / 2).toFixed(2)}" y="${(y + cavH / 2).toFixed(
        2,
      )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${escapeText(label)}</text>
  </g>`;
    })
    .join("\n");

  return `
<g>
  ${header}
  ${blockOutline}
  ${cavRects}
</g>`.trim();
}

/* ================= DXF ================= */

// Super-minimal ASCII DXF: ENTITIES section with block outline + cavities.
// Units = inches in "screen" space: we normalize to a 0,0 origin at block corner.
//
// PATH A UPDATE:
// - If layout.stack[] exists, we write one panel per layer stacked in +Y.
// - Each layer has its own DXF layer names: BLOCK_L1 / CAVITY_L1, etc.
// - Each layer uses cropCorners -> chamfer (using block.chamferIn).

function buildDxf(layout: LayoutLike): string {
  const block = layout?.block || ({} as any);

  const blkLen = clampFinite(block.lengthIn, 0);
  const blkWid = clampFinite(block.widthIn, 0);

  const lines: string[] = [];

  function push(code: number | string, value?: string | number) {
    if (value === undefined) {
      lines.push(String(code));
      return;
    }
    lines.push(String(code));
    lines.push(String(value));
  }

  // Header + ENTITIES section
  push(0, "SECTION");
  push(2, "ENTITIES");

  if (blkLen <= 0 || blkWid <= 0) {
    push(0, "ENDSEC");
    push(0, "EOF");
    return lines.join("\n");
  }

  const stack = Array.isArray((layout as any)?.stack) ? ((layout as any).stack as LayerLike[]) : null;

  // Legacy single-layer path (unchanged)
  if (!stack || stack.length === 0) {
    const cavities = Array.isArray(layout?.cavities) ? layout.cavities : [];
    const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
    const chamferIn = deriveChamferIn(block);

    const c =
      cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
        ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
        : 0;

    writeDxfPanel({
      push,
      blkLen,
      blkWid,
      yOffset: 0,
      chamferIn: c,
      cavities,
      blockLayer: "BLOCK",
      cavityLayer: "CAVITY",
    });

    push(0, "ENDSEC");
    push(0, "EOF");
    return lines.join("\n");
  }

  // Per-layer combined DXF
  const baseChamfer = deriveChamferIn(block);

  stack.forEach((layer, idx) => {
    const cavities = Array.isArray(layer?.cavities) ? (layer!.cavities as CavityLike[]) : [];
    const crop = !!layer?.cropCorners;

    const chamferIn =
      crop && Number.isFinite(baseChamfer) && baseChamfer > 0
        ? Math.max(0, Math.min(baseChamfer, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
        : 0;

    const yOffset = idx * (blkWid + LAYER_GAP_IN);

    writeDxfPanel({
      push,
      blkLen,
      blkWid,
      yOffset,
      chamferIn,
      cavities,
      blockLayer: `BLOCK_L${idx + 1}`,
      cavityLayer: `CAVITY_L${idx + 1}`,
    });
  });

  push(0, "ENDSEC");
  push(0, "EOF");

  return lines.join("\n");
}

function writeDxfPanel(params: {
  push: (code: number | string, value?: string | number) => void;
  blkLen: number;
  blkWid: number;
  yOffset: number;
  chamferIn: number; // already clamped; 0 => square
  cavities: CavityLike[];
  blockLayer: string;
  cavityLayer: string;
}) {
  const { push, blkLen, blkWid, yOffset, chamferIn, cavities, blockLayer, cavityLayer } = params;

  // Block outline as LWPOLYLINE.
  // - Square: 4 vertices
  // - Two-corner chamfer: 6 vertices (matches prior logic)
  const c = Number.isFinite(chamferIn) && chamferIn > 0 ? chamferIn : 0;

  const blockPts: [number, number][] =
    c > 0.0001
      ? [
          // Two-corner chamfer (DXF coords assumed: (0,0)=bottom-left, y up):
          // - Bottom-right chamfer at (blkLen,0)
          // - Top-left chamfer at (0,blkWid)
          [0, 0 + yOffset],
          [blkLen - c, 0 + yOffset],
          [blkLen, c + yOffset],
          [blkLen, blkWid + yOffset],
          [c, blkWid + yOffset],
          [0, blkWid - c + yOffset],
        ]
      : [
          [0, 0 + yOffset],
          [blkLen, 0 + yOffset],
          [blkLen, blkWid + yOffset],
          [0, blkWid + yOffset],
        ];

  push(0, "LWPOLYLINE");
  push(8, blockLayer);
  push(90, blockPts.length);
  push(70, 1); // closed polyline flag
  for (const [x, y] of blockPts) {
    push(10, x);
    push(20, y);
  }

  // Cavities
  for (const cav of cavities || []) {
    const xIn = clampFinite(cav.x, 0) * blkLen;
    const yIn = clampFinite(cav.y, 0) * blkWid + yOffset;
    const len = clampFinite(cav.lengthIn, 0);
    const wid = clampFinite(cav.widthIn, 0);

    if (cav.shape === "circle") {
      const cx = xIn + len / 2;
      const cy = yIn + wid / 2;
      const r = Math.min(len, wid) / 2;
      push(0, "CIRCLE");
      push(8, cavityLayer);
      push(10, cx);
      push(20, cy);
      push(30, 0);
      push(40, r);
    } else {
      const pts: [number, number][] = [
        [xIn, yIn],
        [xIn + len, yIn],
        [xIn + len, yIn + wid],
        [xIn, yIn + wid],
      ];
      push(0, "LWPOLYLINE");
      push(8, cavityLayer);
      push(90, 4);
      push(70, 1);
      for (const [px, py] of pts) {
        push(10, px);
        push(20, py);
      }
    }
  }
}

/* ================= STEP (stub) ================= */

function buildStepStub(_layout: LayoutLike): string {
  // IMPORTANT (Path A):
  // /api/quote/print regenerates exports via buildLayoutExports() and then does:
  //   step_text: bundle.step ?? layoutPkg.step_text
  //
  // If we return any non-empty string here, we overwrite the real STEP produced
  // by the STEP microservice / DB with a stub, causing “blank”/incorrect STEP output.
  //
  // Returning "" makes the ?? fallback keep the real stored STEP.
  return "";
}
