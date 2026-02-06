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
// - Legacy single-layer layouts preserved.
//
// NEW (Path A, additive):
// - Preserve poly cavity exports when cav.shape === "poly" and cav.points[] exists.
//   points[] are normalized in TOP-LEFT space (0..1).
//

type BlockLike = {
  lengthIn: number;
  widthIn: number;
  thicknessIn?: number | null;
  cornerStyle?: "square" | "chamfer" | null;
  chamferIn?: number | null;
  roundCorners?: boolean | null;
  roundRadiusIn?: number | null;
};

type CavityLike = {
  id: string;
  shape: "rect" | "roundedRect" | "circle" | "poly";
  x: number; // normalized 0–1 position from left
  y: number; // normalized 0–1 position from top
  lengthIn: number;
  widthIn: number;
  depthIn?: number | null;
  cornerRadiusIn?: number | null;

  // For poly cavities: normalized points in TOP-LEFT space (0..1)
  points?: Array<{ x: number; y: number }> | null;

  label?: string | null;
};

type LayerLike = {
  thicknessIn: number;
  cavities?: CavityLike[] | null;
  cropCorners?: boolean | null;
  roundCorners?: boolean | null;
  roundRadiusIn?: number | null;
};

type LayoutLike = {
  units?: string | null;
  block: BlockLike;
  cavities?: CavityLike[] | null;
  stack?: LayerLike[] | null;
};

const VIEW_W = 1000;
const VIEW_H = 700;
const PADDING = 40;
const DEFAULT_ROUND_RADIUS_IN = 1;

function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function nnum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildOuterOutlinePolyline(args: {
  lengthIn: number;
  widthIn: number;
  chamferIn?: number;
  roundCorners?: boolean;
  roundRadiusIn?: number;
  segments?: number;
}): { x: number; y: number }[] {
  const L = Number(args.lengthIn) || 0;
  const W = Number(args.widthIn) || 0;
  const c = Number(args.chamferIn) || 0;

  if (L <= 0 || W <= 0) return [];

  // Rounded corners (approx) — used for SVG only.
  if (args.roundCorners && (args.roundRadiusIn ?? 0) > 0.001) {
    const r = Math.max(0, Math.min(Number(args.roundRadiusIn), L / 2 - 0.01, W / 2 - 0.01));
    const seg = Math.max(6, Number(args.segments) || 12);

    const pts: { x: number; y: number }[] = [];

    const arc = (cx: number, cy: number, a0: number, a1: number) => {
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const a = a0 + (a1 - a0) * t;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };

    // CAD space: origin bottom-left.
    // Build clockwise outline starting at (r,0)
    pts.push({ x: r, y: 0 });
    pts.push({ x: L - r, y: 0 });
    arc(L - r, r, -Math.PI / 2, 0);
    pts.push({ x: L, y: W - r });
    arc(L - r, W - r, 0, Math.PI / 2);
    pts.push({ x: r, y: W });
    arc(r, W - r, Math.PI / 2, Math.PI);
    pts.push({ x: 0, y: r });
    arc(r, r, Math.PI, (3 * Math.PI) / 2);

    return pts;
  }

  // Chamfer
  if (c > 0.001 && L > 2 * c && W > 2 * c) {
    return [
      { x: c, y: 0 },
      { x: L - c, y: 0 },
      { x: L, y: c },
      { x: L, y: W - c },
      { x: L - c, y: W },
      { x: c, y: W },
      { x: 0, y: W - c },
      { x: 0, y: c },
    ];
  }

  // Square
  return [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ];
}

// Converts CAD points (inches, origin bottom-left) to SVG path (origin top-left)
function svgPathFromOutline(
  points: { x: number; y: number }[],
  opts: { offsetX: number; offsetY: number; scale: number; heightPx: number },
): string {
  if (!points.length) return "";
  const { offsetX, offsetY, scale, heightPx } = opts;

  const mapped = points.map((p) => {
    const x = offsetX + p.x * scale;
    const y = offsetY + (heightPx - p.y * scale);
    return [x, y] as const;
  });

  const [firstX, firstY] = mapped[0];
  const rest = mapped.slice(1);

  const parts = [`M ${firstX.toFixed(2)} ${firstY.toFixed(2)}`];
  for (const [x, y] of rest) parts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  parts.push("Z");
  return parts.join(" ");
}

function getStack(layout: LayoutLike): LayerLike[] | null {
  const s = Array.isArray((layout as any)?.stack)
    ? ((layout as any).stack as LayerLike[])
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
  const round = !!block.roundCorners;
  const roundRaw = Number(block.roundRadiusIn);
  const roundRadiusIn =
    Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : DEFAULT_ROUND_RADIUS_IN;

  const chamferPx =
    cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
      ? chamferIn * scale
      : 0;

  const c = Math.max(
    0,
    Math.min(chamferPx, blockW / 2 - 0.01, blockH / 2 - 0.01),
  );

  const roundPx = round ? roundRadiusIn * scale : 0;
  const r = Math.max(
    0,
    Math.min(roundPx, blockW / 2 - 0.01, blockH / 2 - 0.01),
  );

  const blockOutline =
    r > 0.001
      ? (() => {
          const pts = buildOuterOutlinePolyline({
            lengthIn: L,
            widthIn: W,
            roundCorners: true,
            roundRadiusIn: roundRadiusIn,
            segments: 12,
          });
          const d = svgPathFromOutline(pts, {
            offsetX: blockX,
            offsetY: blockY,
            scale,
            heightPx: blockH,
          });
          return `<path d="${d}" fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;
        })()
      : c > 0.001
      ? (() => {
          // Chamfered outline for SVG (top-left space)
          const ptsCad = [
            { x: c / scale, y: 0 },
            { x: L - c / scale, y: 0 },
            { x: L, y: c / scale },
            { x: L, y: W - c / scale },
            { x: L - c / scale, y: W },
            { x: c / scale, y: W },
            { x: 0, y: W - c / scale },
            { x: 0, y: c / scale },
          ];
          const d = svgPathFromOutline(ptsCad, {
            offsetX: blockX,
            offsetY: blockY,
            scale,
            heightPx: blockH,
          });
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

      if (
        cav.shape === "poly" &&
        Array.isArray((cav as any).points) &&
        (cav as any).points.length >= 3
      ) {
        const pts = ((cav as any).points as any[])
          .map((p) => ({
            x: blockX + nnum(p?.x) * blockW,
            y: blockY + nnum(p?.y) * blockH,
          }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

        if (pts.length >= 3) {
          const ptsAttr = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
          const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;

          return `
  <g>
    <polygon points="${ptsAttr}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(
            2,
          )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${escapeText(label)}</text>
  </g>`;
        }
      }

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

  // panel layout
  const gap = 28;
  const titleH = 28;
  const panelH = Math.max(140, Math.min(220, (VIEW_H - 2 * PADDING - gap * (stack.length - 1)) / stack.length));

  const panels: string[] = [];

  for (let i = 0; i < stack.length; i++) {
    const layer = stack[i] || {};
    const yOff = i * (panelH + gap);

    const cavs = Array.isArray(layer.cavities) ? (layer.cavities as CavityLike[]) : [];
    const crop = !!layer.cropCorners;
    const round = !!layer.roundCorners;
    const roundRaw = Number(layer.roundRadiusIn);
    const roundRadiusIn =
      Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : DEFAULT_ROUND_RADIUS_IN;

    console.log("[EXPORTS] layer", i, "cropCorners:", crop, "layout.block.cornerStyle:", layout?.block?.cornerStyle);

    // Build a derived "single-layer" block style for this layer.
    // If cropCorners is true, force chamfer for THIS layer only.
    const block: BlockLike = {
      ...layout.block,
      cornerStyle: !round && crop ? "chamfer" : "square",
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

    const roundPx = round ? roundRadiusIn * scale : 0;
    const r = Math.max(
      0,
      Math.min(roundPx, blockW / 2 - 0.01, blockH / 2 - 0.01),
    );

    const blockOutline =
      r > 0.001
        ? (() => {
            const pts = buildOuterOutlinePolyline({
              lengthIn: L,
              widthIn: W,
              roundCorners: true,
              roundRadiusIn: roundRadiusIn,
              segments: 12,
            });
            const d = svgPathFromOutline(pts, {
              offsetX: blockX,
              offsetY: blockY,
              scale,
              heightPx: blockH,
            });
            return `<path d="${d}" fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;
          })()
        : c > 0.001
        ? (() => {
            // Chamfered outline for SVG (top-left space)
            const ptsCad = [
              { x: c / scale, y: 0 },
              { x: L - c / scale, y: 0 },
              { x: L, y: c / scale },
              { x: L, y: W - c / scale },
              { x: L - c / scale, y: W },
              { x: c / scale, y: W },
              { x: 0, y: W - c / scale },
              { x: 0, y: c / scale },
            ];
            const d = svgPathFromOutline(ptsCad, {
              offsetX: blockX,
              offsetY: blockY,
              scale,
              heightPx: blockH,
            });
            return `<path d="${d}" fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;
          })()
        : `<rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}"
          width="${blockW.toFixed(2)}" height="${blockH.toFixed(2)}"
          fill="#e5f0ff" stroke="#1d4ed8" stroke-width="2" />`;

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

        if (
          cav.shape === "poly" &&
          Array.isArray((cav as any).points) &&
          (cav as any).points.length >= 3
        ) {
          const pts = ((cav as any).points as any[])
            .map((p) => ({
              x: blockX + nnum(p?.x) * blockW,
              y: blockY + nnum(p?.y) * blockH,
            }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

          if (pts.length >= 3) {
            const ptsAttr = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
            const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
            const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;

            return `
  <g>
    <polygon points="${ptsAttr}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(
              2,
            )}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${escapeText(label)}</text>
  </g>`;
          }
        }

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

    panels.push(
      `<g>
  ${blockOutline}
${cavRects}
  <text x="${(PADDING + 4).toFixed(2)}" y="${(yOff + 16).toFixed(
        2,
      )}" font-size="12" fill="#0f172a">${escapeText(`Layer ${i + 1}`)}</text>
</g>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg">
${panels.join("\n")}
</svg>`;
}

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
  const round = !!block.roundCorners;
  const roundRaw = Number(block.roundRadiusIn);
  const roundRadiusIn =
    Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : DEFAULT_ROUND_RADIUS_IN;
  const c =
    cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
      ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
      : 0;

  const blockPts: [number, number][] =
    round
      ? buildOuterOutlinePolyline({
          lengthIn: blkLen,
          widthIn: blkWid,
          roundCorners: true,
          roundRadiusIn: roundRadiusIn,
          segments: 12,
        }).map((pt) => [pt.x, pt.y])
      : c > 0.0001
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
    const len = nnum(cav.lengthIn);
    const wid = nnum(cav.widthIn);

    // X stays the same
    const xLeft = nnum(cav.x) * blkLen;

    // Y-FLIP (match STEP): editor y is from TOP, CAD y is from BOTTOM.
    // For rectangles: top-left at yTop = W*(1-y) - height
    // For circles: top-left box at yTop = W*(1-y) - 2r
    if (
      cav.shape === "poly" &&
      Array.isArray((cav as any).points) &&
      (cav as any).points.length >= 3
    ) {
      const pts = ((cav as any).points as any[])
        .map((p) => [nnum(p?.x) * blkLen, blkWid * (1 - nnum(p?.y))] as [number, number])
        .filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));

      if (pts.length >= 3) {
        push(0, "LWPOLYLINE");
        push(8, "CAVITY");
        push(90, pts.length);
        push(70, 1);
        for (const [px, py] of pts) {
          push(10, px);
          push(20, py);
        }
      }
      continue;
    }

    if (cav.shape === "circle") {
      const r = Math.min(len, wid) / 2;

      let x = xLeft;
      let yTop = blkWid * (1 - nnum(cav.y)) - (2 * r);

      // clamp inside the block
      x = Math.max(0, Math.min(blkLen - 2 * r, x));
      yTop = Math.max(0, Math.min(blkWid - 2 * r, yTop));

      const cx = x + r;
      const cy = yTop + r;

      push(0, "CIRCLE");
      push(8, "CAVITY");
      push(10, cx);
      push(20, cy);
      push(30, 0);
      push(40, r);
    } else {
      let x = xLeft;
      let yTop = blkWid * (1 - nnum(cav.y)) - wid;

      // clamp inside the block
      x = Math.max(0, Math.min(blkLen - len, x));
      yTop = Math.max(0, Math.min(blkWid - wid, yTop));

      const pts: [number, number][] = [
        [x, yTop],
        [x + len, yTop],
        [x + len, yTop + wid],
        [x, yTop + wid],
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
  const { block } = layout as any;

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

  // stacked: we offset each layer in Y so layers don't overlap in DXF
  const gap = 1; // in inches
  const panelH = blkWid;
  const totalH = stack.length * panelH + gap * (stack.length - 1);

  // block outlines per layer
  for (let i = 0; i < stack.length; i++) {
    const layer = stack[i] || {};
    const yOff = i * (panelH + gap);
    const crop = !!layer.cropCorners;
    const round = !!layer.roundCorners;
    const roundRaw = Number(layer.roundRadiusIn);
    const roundRadiusIn =
      Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : DEFAULT_ROUND_RADIUS_IN;

    const cornerStyle = !round && crop ? "chamfer" : "square";
    const chamferIn = 1;

    const c =
      cornerStyle === "chamfer"
        ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
        : 0;

    const blockPts: [number, number][] =
      round
        ? buildOuterOutlinePolyline({
            lengthIn: blkLen,
            widthIn: blkWid,
            roundCorners: true,
            roundRadiusIn: roundRadiusIn,
            segments: 12,
          }).map((pt) => [pt.x, pt.y + yOff])
        : c > 0.0001
        ? [
            [0, 0 + yOff],
            [blkLen - c, 0 + yOff],
            [blkLen, c + yOff],
            [blkLen, blkWid + yOff],
            [c, blkWid + yOff],
            [0, blkWid - c + yOff],
          ]
        : [
            [0, 0 + yOff],
            [blkLen, 0 + yOff],
            [blkLen, blkWid + yOff],
            [0, blkWid + yOff],
          ];

    push(0, "LWPOLYLINE");
    push(8, "BLOCK");
    push(90, blockPts.length);
    push(70, 1);
    for (const [x, y] of blockPts) {
      push(10, x);
      push(20, y);
    }
  }

  for (let i = 0; i < stack.length; i++) {
    const layer = stack[i] || {};
    const yOff = i * (panelH + gap);
    const layerNo = i + 1;

    const cavs = Array.isArray(layer.cavities) ? (layer.cavities as CavityLike[]) : [];

    for (const cav of cavs) {
      const len = nnum(cav.lengthIn);
      const wid = nnum(cav.widthIn);

      const xLeft = nnum(cav.x) * blkLen;

      if (
        cav.shape === "poly" &&
        Array.isArray((cav as any).points) &&
        (cav as any).points.length >= 3
      ) {
        const pts = ((cav as any).points as any[])
          .map((p) => [nnum(p?.x) * blkLen, blkWid * (1 - nnum(p?.y)) + yOff] as [number, number])
          .filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));

        if (pts.length >= 3) {
          push(0, "LWPOLYLINE");
          push(8, `CAVITY_L${layerNo}`);
          push(90, pts.length);
          push(70, 1);
          for (const [px, py] of pts) {
            push(10, px);
            push(20, py);
          }
        }
        continue;
      }

      if (cav.shape === "circle") {
        const r = Math.min(len, wid) / 2;

        let x = xLeft;
        let yTop = blkWid * (1 - nnum(cav.y)) - (2 * r);

        x = Math.max(0, Math.min(blkLen - 2 * r, x));
        yTop = Math.max(0, Math.min(blkWid - 2 * r, yTop));

        const cx = x + r;
        const cy = (yTop + r) + yOff;

        push(0, "CIRCLE");
        push(8, `CAVITY_L${layerNo}`);
        push(10, cx);
        push(20, cy);
        push(30, 0);
        push(40, r);
      } else {
        let x = xLeft;
        let yTop = blkWid * (1 - nnum(cav.y)) - wid;

        x = Math.max(0, Math.min(blkLen - len, x));
        yTop = Math.max(0, Math.min(blkWid - wid, yTop));

        const pts: [number, number][] = [
          [x, yTop + yOff],
          [x + len, yTop + yOff],
          [x + len, yTop + wid + yOff],
          [x, yTop + wid + yOff],
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

export function buildLayoutExports(layout: LayoutLike) {
  return {
    svg: buildSvg(layout),
    dxf: buildDxf(layout),
    step: buildStepStub(layout),
  };
}
