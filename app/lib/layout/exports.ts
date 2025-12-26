// app/lib/layout/exports.ts
//
// Server-side helpers to turn a LayoutModel-shaped object into:
//   - SVG (top view)
//   - DXF (simple 2D drawing – block + cavities)
//   - STEP (very minimal placeholder text for now)
//
// PATH A CHANGE:
// - Add Option A: per-layer exports when layout.stack[] exists.
// - Uses layer.cropCorners to chamfer ONLY that layer’s block outline.
// - Legacy single-layer { block, cavities } output remains unchanged.

export type LayoutExportBundle = {
  svg: string;
  dxf: string;
  step: string;
};

type BlockLike = {
  lengthIn: number;
  widthIn: number;
  thicknessIn?: number | null;

  // optional corner metadata (persisted by layout editor)
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
  cavities?: CavityLike[];

  // NEW: optional multi-layer stack (source of truth for Option A exports)
  stack?: LayerLike[] | null;
  layers?: LayerLike[] | null; // tolerate alt key
};

const VIEW_W = 1000;
const VIEW_H = 700;
const PADDING = 40;

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

function nnum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getStack(layout: LayoutLike): LayerLike[] | null {
  const s = Array.isArray((layout as any)?.stack)
    ? ((layout as any).stack as LayerLike[])
    : Array.isArray((layout as any)?.layers)
      ? ((layout as any).layers as LayerLike[])
      : null;

  if (!s || s.length === 0) return null;
  return s;
}

function buildSvg(layout: LayoutLike): string {
  const stack = getStack(layout);

  // OPTION A: per-layer stacked SVG
  if (stack && stack.length > 0) {
    return buildSvgStacked(layout, stack);
  }

  // Legacy: single view
  const { block, cavities = [] } = layout as any;

  const L = nnum(block?.lengthIn, 0);
  const W = nnum(block?.widthIn, 0);

  if (L <= 0 || W <= 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  }

  const scaleX = (VIEW_W - 2 * PADDING) / L;
  const scaleY = (VIEW_H - 2 * PADDING) / W;
  const scale = Math.min(scaleX, scaleY);

  const blockW = L * scale;
  const blockH = W * scale;
  const blockX = (VIEW_W - blockW) / 2;
  const blockY = (VIEW_H - blockH) / 2;

  const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
  const chamferInRaw = block.chamferIn;
  const chamferIn = chamferInRaw == null ? 0 : Number(chamferInRaw);

  const chamferPx =
    cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
      ? chamferIn * scale
      : 0;

  const c = Math.max(
    0,
    Math.min(chamferPx, blockW / 2 - 0.01, blockH / 2 - 0.01),
  );

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

  const cavRects = (cavities as CavityLike[])
    .map((cav) => {
      const cavW = nnum(cav.lengthIn) * scale;
      const cavH = nnum(cav.widthIn) * scale;
      const x = blockX + nnum(cav.x) * blockW;
      const y = blockY + nnum(cav.y) * blockH;

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

      const rx = cav.cornerRadiusIn ? nnum(cav.cornerRadiusIn) * scale : 0;
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg">
  ${blockOutline}
${cavRects}
</svg>`;
}

function buildSvgStacked(layout: LayoutLike, stack: LayerLike[]): string {
  const L = nnum(layout?.block?.lengthIn, 0);
  const W = nnum(layout?.block?.widthIn, 0);

  if (L <= 0 || W <= 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  }

  // We render one "panel" per layer, stacked vertically.
  // Keep VIEW_W constant, grow height.
  const panelH = VIEW_H;
  const gap = 30;
  const titleH = 28;

  const totalH = stack.length * panelH + Math.max(0, stack.length - 1) * gap;

  const panels: string[] = [];

  for (let i = 0; i < stack.length; i++) {
    const layer = stack[i] || {};
    const yOff = i * (panelH + gap);

    const cavs = Array.isArray(layer.cavities) ? (layer.cavities as CavityLike[]) : [];
    const crop = !!layer.cropCorners;

    console.log("[EXPORTS] layer", i, "cropCorners:", crop, "layout.block.cornerStyle:", layout?.block?.cornerStyle);


    // Build a derived "single-layer" block style for this layer.
    // If cropCorners is true, force chamfer for THIS layer only.
    const block: BlockLike = {
      ...layout.block,
      cornerStyle: crop ? "chamfer" : "square",
      chamferIn: layout.block.chamferIn ?? 1,
    };

    const scaleX = (VIEW_W - 2 * PADDING) / L;
    const scaleY = (panelH - 2 * PADDING - titleH) / W;
    const scale = Math.min(scaleX, scaleY);

    const blockW = L * scale;
    const blockH = W * scale;
    const blockX = (VIEW_W - blockW) / 2;
    const blockY = yOff + titleH + (panelH - titleH - blockH) / 2;

    const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
    const chamferInRaw = block.chamferIn;
    const chamferIn = chamferInRaw == null ? 0 : Number(chamferInRaw);

    const chamferPx =
      cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
        ? chamferIn * scale
        : 0;

    const c = Math.max(
      0,
      Math.min(chamferPx, blockW / 2 - 0.01, blockH / 2 - 0.01),
    );

    const blockOutline =
      c > 0.001
        ? (() => {
            const x0 = blockX;
            const y0 = blockY;
            const x1 = blockX + blockW;
            const y1 = blockY + blockH;

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

    const title =
      (typeof layer.label === "string" && layer.label.trim().length > 0
        ? layer.label.trim()
        : `Layer ${i + 1}`) +
      (layer.thicknessIn != null && Number.isFinite(Number(layer.thicknessIn)) && Number(layer.thicknessIn) > 0
        ? `  (${Number(layer.thicknessIn)} in)`
        : "") +
      (crop ? "  • Cropped corners" : "");

    const cavRects = cavs
      .map((cav) => {
        const cavW = nnum(cav.lengthIn) * scale;
        const cavH = nnum(cav.widthIn) * scale;
        const x = blockX + nnum(cav.x) * blockW;
        const y = blockY + nnum(cav.y) * blockH;

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

        const rx = cav.cornerRadiusIn ? nnum(cav.cornerRadiusIn) * scale : 0;
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

    panels.push(`
  <g transform="translate(0, 0)">
    <text x="${PADDING}" y="${(yOff + 18).toFixed(
      2,
    )}" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      font-size="14" fill="#111827">${escapeText(title)}</text>
    ${blockOutline}
    ${cavRects}
  </g>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${totalH}" viewBox="0 0 ${VIEW_W} ${totalH}" xmlns="http://www.w3.org/2000/svg">
${panels.join("\n")}
</svg>`;
}

/* ================= DXF ================= */

// Super-minimal ASCII DXF: ENTITIES section with block outline + cavities.
// For per-layer exports, we separate entities onto different DXF layers:
//   - BLOCK_L1, CAVITY_L1, BLOCK_L2, CAVITY_L2, ...
// This is Option A.

function buildDxf(layout: LayoutLike): string {
  const stack = getStack(layout);

  if (stack && stack.length > 0) {
    return buildDxfStacked(layout, stack);
  }

  const { block, cavities = [] } = layout as any;

  const lines: string[] = [];

  function push(code: number | string, value?: string | number) {
    if (value === undefined) {
      lines.push(String(code));
      return;
    }
    lines.push(String(code));
    lines.push(String(value));
  }

  push(0, "SECTION");
  push(2, "ENTITIES");

  const blkLen = nnum(block?.lengthIn, 0);
  const blkWid = nnum(block?.widthIn, 0);

  const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
  const chamferInRaw = block.chamferIn;
  const chamferIn = chamferInRaw == null ? 0 : Number(chamferInRaw);
  const c =
    cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
      ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
      : 0;

  const blockPts: [number, number][] =
    c > 0.0001
      ? [
          [0, 0],
          [blkLen - c, 0],
          [blkLen, c],
          [blkLen, blkWid],
          [c, blkWid],
          [0, blkWid - c],
        ]
      : [
          [0, 0],
          [blkLen, 0],
          [blkLen, blkWid],
          [0, blkWid],
        ];

  push(0, "LWPOLYLINE");
  push(8, "BLOCK");
  push(90, blockPts.length);
  push(70, 1);
  for (const [x, y] of blockPts) {
    push(10, x);
    push(20, y);
  }

  for (const cav of cavities as CavityLike[]) {
    const xIn = nnum(cav.x) * blkLen;
    const yIn = nnum(cav.y) * blkWid;
    const len = nnum(cav.lengthIn);
    const wid = nnum(cav.widthIn);

    if (cav.shape === "circle") {
      const cx = xIn + len / 2;
      const cy = yIn + wid / 2;
      const r = Math.min(len, wid) / 2;
      push(0, "CIRCLE");
      push(8, "CAVITY");
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
      push(8, "CAVITY");
      push(90, 4);
      push(70, 1);
      for (const [px, py] of pts) {
        push(10, px);
        push(20, py);
      }
    }
  }

  push(0, "ENDSEC");
  push(0, "EOF");

  return lines.join("\n");
}

function buildDxfStacked(layout: LayoutLike, stack: LayerLike[]): string {
  const block = layout?.block || ({} as any);

  const blkLen = nnum(block?.lengthIn, 0);
  const blkWid = nnum(block?.widthIn, 0);

  const lines: string[] = [];

  function push(code: number | string, value?: string | number) {
    if (value === undefined) {
      lines.push(String(code));
      return;
    }
    lines.push(String(code));
    lines.push(String(value));
  }

  push(0, "SECTION");
  push(2, "ENTITIES");

  const baseChamfer = Number(block?.chamferIn);
  const chamferInDefault =
    Number.isFinite(baseChamfer) && baseChamfer > 0 ? baseChamfer : 1;

  for (let i = 0; i < stack.length; i++) {
    const layer = stack[i] || {};
    const layerNo = i + 1;

    const crop = !!layer.cropCorners;

    const cornerStyle = crop ? "chamfer" : "square";
    const chamferIn =
      cornerStyle === "chamfer"
        ? chamferInDefault
        : 0;

    const c =
      cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
        ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
        : 0;

    const blockPts: [number, number][] =
      c > 0.0001
        ? [
            [0, 0],
            [blkLen - c, 0],
            [blkLen, c],
            [blkLen, blkWid],
            [c, blkWid],
            [0, blkWid - c],
          ]
        : [
            [0, 0],
            [blkLen, 0],
            [blkLen, blkWid],
            [0, blkWid],
          ];

    // BLOCK outline on BLOCK_Ln
    push(0, "LWPOLYLINE");
    push(8, `BLOCK_L${layerNo}`);
    push(90, blockPts.length);
    push(70, 1);
    for (const [x, y] of blockPts) {
      push(10, x);
      push(20, y);
    }

    const cavs = Array.isArray(layer.cavities) ? (layer.cavities as CavityLike[]) : [];

    for (const cav of cavs) {
      const xIn = nnum(cav.x) * blkLen;
      const yIn = nnum(cav.y) * blkWid;
      const len = nnum(cav.lengthIn);
      const wid = nnum(cav.widthIn);

      if (cav.shape === "circle") {
        const cx = xIn + len / 2;
        const cy = yIn + wid / 2;
        const r = Math.min(len, wid) / 2;
        push(0, "CIRCLE");
        push(8, `CAVITY_L${layerNo}`);
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
        push(8, `CAVITY_L${layerNo}`);
        push(90, 4);
        push(70, 1);
        for (const [px, py] of pts) {
          push(10, px);
          push(20, py);
        }
      }
    }
  }

  push(0, "ENDSEC");
  push(0, "EOF");
  return lines.join("\n");
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
