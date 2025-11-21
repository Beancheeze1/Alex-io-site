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

function buildSvg(layout: LayoutLike): string {
  const { block, cavities } = layout;

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

      const label =
        c.label ??
        (c.shape === "circle"
          ? `Ø${c.lengthIn}×${c.depthIn ?? ""}"`.trim()
          : `${c.lengthIn}×${c.widthIn}×${c.depthIn ?? ""}"`.trim());

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

  // Block outline (rectangle)
  const blkLen = block.lengthIn;
  const blkWid = block.widthIn;

  // Use a lightweight polyline (LWPOLYLINE) for the block border
  push(0, "LWPOLYLINE");
  push(8, "BLOCK"); // layer name
  push(90, 4); // number of vertices
  push(70, 1); // closed polyline flag
  // points (x,y):
  const blockPts: [number, number][] = [
    [0, 0],
    [blkLen, 0],
    [blkLen, blkWid],
    [0, blkWid],
  ];
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
      // center at cavity center
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
      // rect / roundedRect -> polyline rectangle
      const pts: [number, number][] = [
        [xIn, yIn],
        [xIn + len, yIn],
        [xIn + len, yIn + wid],
        [xIn, yIn + wid],
      ];
      push(0, "LWPOLYLINE");
      push(8, "CAVITY");
      push(90, 4);
      push(70, 1); // closed
      for (const [px, py] of pts) {
        push(10, px);
        push(20, py);
      }
    }
  }

  // End ENTITIES and file
  push(0, "ENDSEC");
  push(0, "EOF");

  return lines.join("\n");
}

/* ================= STEP (stub) ================= */

// Proper 3D STEP modeling requires a CAD kernel. For now we emit a small,
// well-formed text "stub" that still carries all the layout metadata and can
// be regenerated into real geometry later if needed.

function buildStepStub(layout: LayoutLike): string {
  const { block, cavities } = layout;

  const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Alex-IO foam layout export'),'2;1');
FILE_NAME('foam_layout.stp','${new Date().toISOString()}',('Alex-IO'),('Alex-IO'), 'Alex-IO','Alex-IO','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
`;

  const bodyLines: string[] = [];

  bodyLines.push(
    `/* BLOCK: ${block.lengthIn} x ${block.widthIn} x ${
      block.thicknessIn ?? ""
    } in */`
  );
  cavities.forEach((cav, idx) => {
    bodyLines.push(
      `/* CAVITY ${idx + 1}: shape=${cav.shape}, x=${cav.x.toFixed(
        4
      )}, y=${cav.y.toFixed(4)}, L=${cav.lengthIn}, W=${cav.widthIn}, D=${
        cav.depthIn ?? ""
     } */`
    );
  });

  const footer = `
ENDSEC;
END-ISO-10303-21;
`;

  return header + bodyLines.join("\n") + footer;
}
