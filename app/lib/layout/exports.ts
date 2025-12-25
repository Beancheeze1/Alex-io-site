// app/lib/layout/exports.ts
//
// Server-side helpers to turn a LayoutModel-shaped object into:
//   - SVG (top view)
//   - DXF (simple 2D drawing – block + cavities)
//   - STEP (very minimal placeholder text for now)
//
// NOTE: We're keeping types loose here so we don't fight the app-side types.
//       The layout object is whatever the layout editor sends (LayoutModel).

export type LayoutExportBundle = {
  svg: string;
  dxf: string;
  step: string;
};

type BlockLike = {
  lengthIn: number;
  widthIn: number;
  thicknessIn?: number | null;

  // NEW: optional corner metadata (persisted by layout editor)
  cornerStyle?: string | null; // "square" | "chamfer"
  chamferIn?: number | null;   // inches
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

type LayoutLike = {
  block: BlockLike;
  cavities: CavityLike[];
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

function buildSvg(layout: LayoutLike): string {
  const { block, cavities } = layout;

  const L = Number(block.lengthIn) || 0;
  const W = Number(block.widthIn) || 0;

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

  // --- Block outline (square OR chamfer) ---
  const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
  const chamferInRaw = block.chamferIn;
  const chamferIn = chamferInRaw == null ? 0 : Number(chamferInRaw);

  const chamferPx =
    cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
      ? chamferIn * scale
      : 0;

  // Clamp chamfer so it can't exceed half the side
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
            // start just below top-left chamfer on left edge
            `M ${x0.toFixed(2)} ${(y0 + c).toFixed(2)}`,

            // left edge down to bottom-left (square)
            `L ${x0.toFixed(2)} ${y1.toFixed(2)}`,

            // bottom edge to just before bottom-right chamfer
            `L ${(x1 - c).toFixed(2)} ${y1.toFixed(2)}`,

            // bottom-right chamfer
            `L ${x1.toFixed(2)} ${(y1 - c).toFixed(2)}`,

            // right edge up to top-right (square)
            `L ${x1.toFixed(2)} ${y0.toFixed(2)}`,

            // top edge to just after top-left chamfer
            `L ${(x0 + c).toFixed(2)} ${y0.toFixed(2)}`,

            `Z`,
          ].join(" ");


          return `<path d="${d}" fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;
        })()
      : `<rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}"
        width="${blockW.toFixed(2)}" height="${blockH.toFixed(2)}"
        fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;

  const cavRects = cavities
    .map((cav) => {
      const cavW = cav.lengthIn * scale;
      const cavH = cav.widthIn * scale;
      const x = blockX + cav.x * blockW;
      const y = blockY + cav.y * blockH;

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

      const rx = (cav.cornerRadiusIn ? cav.cornerRadiusIn * scale : 0);
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

/* ================= DXF ================= */

// Super-minimal ASCII DXF: just ENTITIES section with block outline + cavities.
// Units = inches in "screen" space: we normalize to a 0,0 origin at block corner.

function buildDxf(layout: LayoutLike): string {
  const { block, cavities } = layout;

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

  const blkLen = Number(block.lengthIn) || 0;
  const blkWid = Number(block.widthIn) || 0;

  // Determine chamfer behavior
  const cornerStyle = String(block.cornerStyle ?? "").toLowerCase();
  const chamferInRaw = block.chamferIn;
  const chamferIn = chamferInRaw == null ? 0 : Number(chamferInRaw);
  const c =
    cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
      ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
      : 0;

  // Block outline as LWPOLYLINE.
  // - Square: 4 vertices
  // - Chamfer: 8 vertices
    const blockPts: [number, number][] =
    c > 0.0001
      ? [
          // Two-corner chamfer (DXF coords assumed: (0,0)=bottom-left, y up):
          // - Bottom-right chamfer at (blkLen,0)
          // - Top-left chamfer at (0,blkWid)

          // start at bottom-left (square)
          [0, 0],

          // bottom edge to just before bottom-right chamfer
          [blkLen - c, 0],

          // bottom-right chamfer
          [blkLen, c],

          // right edge to top-right (square)
          [blkLen, blkWid],

          // top edge to just after top-left chamfer
          [c, blkWid],

          // top-left chamfer
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
  push(70, 1); // closed polyline flag
  for (const [x, y] of blockPts) {
    push(10, x);
    push(20, y);
  }

  // Cavities
  for (const cav of cavities) {
    const xIn = cav.x * blkLen;
    const yIn = cav.y * blkWid;
    const len = cav.lengthIn;
    const wid = cav.widthIn;

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

