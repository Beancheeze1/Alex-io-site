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

import { createHash } from "crypto";
import { buildOuterOutlinePolyline } from "./outline";

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
  roundCorners?: boolean | null;
  roundRadiusIn?: number | null;
};

type CavityPoint = { x: number; y: number };

type CavityLike = {
  id: string;
  shape: "rect" | "roundedRect" | "circle" | "poly";
  x: number; // normalized 01 position from left
  y: number; // normalized 01 position from top
  lengthIn: number;
  widthIn: number;
  depthIn?: number | null;
  cornerRadiusIn?: number | null;

  // NEW: polygon cavities (normalized points in block coordinates, top-left origin)
  points?: CavityPoint[] | null;

  label?: string | null;
};

type LayerLike = {
  id?: string | null;
  label?: string | null;
  thicknessIn?: number | null;
  cropCorners?: boolean | null;
  roundCorners?: boolean | null;
  roundRadiusIn?: number | null;
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
const DEFAULT_ROUND_RADIUS_IN = 0.25;

function normalizeUnits(raw: any): "in" | "mm" | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "mm" || s === "millimeter" || s === "millimeters") return "mm";
  if (s === "in" || s === "inch" || s === "inches") return "in";
  return null;
}

function toInches(n: number, units: "in" | "mm" | null): number {
  if (!Number.isFinite(n)) return n;
  if (units === "mm") return n / 25.4;
  return n;
}

function fixed(n: number, places = 4): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(places);
}

function stableStringify(value: any): string {
  if (value === null || value === undefined || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function computeGeometryHash(layout: LayoutLike): string {
  const units =
    normalizeUnits((layout as any)?.units) ??
    normalizeUnits((layout as any)?.block?.units) ??
    null;

  const block = (layout as any)?.block ?? {};
  const blockL = toInches(Number(block?.lengthIn ?? block?.length_in ?? block?.length), units);
  const blockW = toInches(Number(block?.widthIn ?? block?.width_in ?? block?.width), units);
  const blockH = toInches(
    Number(block?.thicknessIn ?? block?.thickness_in ?? block?.heightIn ?? block?.height_in),
    units,
  );

  const stack = getStack(layout);
  const layerThicknesses: string[] = [];
  if (stack && stack.length > 0) {
    for (const layer of stack) {
      const t = toInches(
        Number((layer as any)?.thicknessIn ?? (layer as any)?.thickness_in ?? (layer as any)?.heightIn),
        units,
      );
      if (Number.isFinite(t) && t > 0) layerThicknesses.push(fixed(t, 4));
    }
  } else if (Number.isFinite(blockH) && blockH > 0) {
    layerThicknesses.push(fixed(blockH, 4));
  }

  const materialFamilyRaw =
    (layout as any)?.materialFamily ??
    (layout as any)?.material_family ??
    (layout as any)?.material?.family ??
    (layout as any)?.material?.material_family ??
    null;
  const materialFamily =
    typeof materialFamilyRaw === "string" && materialFamilyRaw.trim().length > 0
      ? materialFamilyRaw.trim().toLowerCase()
      : null;

  const densRaw =
    (layout as any)?.materialDensity ??
    (layout as any)?.material_density_lb_ft3 ??
    (layout as any)?.material?.density_lb_ft3 ??
    (layout as any)?.material?.density ??
    null;
  const densNum = Number(densRaw);
  const densityLbFt3 = Number.isFinite(densNum) && densNum > 0 ? fixed(densNum, 4) : null;

  const blockLen = Number.isFinite(blockL) && blockL > 0 ? blockL : null;
  const blockWid = Number.isFinite(blockW) && blockW > 0 ? blockW : null;

  type HashCavity = {
    layer: number;
    type: string;
    shape: string;
    x: string;
    y: string;
    diameter?: string | null;
    points?: { x: string; y: string }[] | null;
  };

  const cavitiesOut: HashCavity[] = [];

  const pushCavity = (cav: any, layerIndex: number) => {
    const shape = resolveCavityShape(cav);
    const typeRaw = cav?.type ?? cav?.shape ?? shape;
    const type = typeof typeRaw === "string" ? typeRaw.trim().toLowerCase() : String(typeRaw);

    const x = norm01(cav?.x);
    const y = norm01(cav?.y);

    const entry: HashCavity = {
      layer: layerIndex,
      type,
      shape,
      x: fixed(x, 6),
      y: fixed(y, 6),
    };

    if (shape === "poly") {
      const pts = resolvedPolyPoints(cav);
      entry.points =
        pts && pts.length
          ? pts.map((p) => ({ x: fixed(norm01(p.x), 6), y: fixed(norm01(p.y), 6) }))
          : null;
    } else if (shape === "circle") {
      const diaRaw = coerceDiameterIn(cav);
      const dia = toInches(Number(diaRaw ?? cav?.lengthIn ?? cav?.widthIn), units);
      entry.diameter = Number.isFinite(dia) && dia > 0 ? fixed(dia, 4) : null;
    } else {
      const len = toInches(Number(cav?.lengthIn ?? cav?.length_in), units);
      const wid = toInches(Number(cav?.widthIn ?? cav?.width_in), units);
      if (blockLen && blockWid && Number.isFinite(len) && Number.isFinite(wid) && len > 0 && wid > 0) {
        const wNorm = len / blockLen;
        const hNorm = wid / blockWid;
        entry.points = [
          { x: fixed(0, 6), y: fixed(0, 6) },
          { x: fixed(wNorm, 6), y: fixed(0, 6) },
          { x: fixed(wNorm, 6), y: fixed(hNorm, 6) },
          { x: fixed(0, 6), y: fixed(hNorm, 6) },
        ];
      }
    }

    cavitiesOut.push(entry);
  };

  if (stack && stack.length > 0) {
    for (let i = 0; i < stack.length; i++) {
      const cavs = Array.isArray((stack[i] as any)?.cavities) ? (stack[i] as any).cavities : [];
      for (const cav of cavs) pushCavity(cav, i);
    }
  } else if (Array.isArray((layout as any)?.cavities)) {
    for (const cav of (layout as any).cavities) pushCavity(cav, 0);
  }

  const cavities = cavitiesOut
    .map((c) => ({
      ...c,
      __key: stableStringify(c),
    }))
    .sort((a, b) => (a.__key < b.__key ? -1 : a.__key > b.__key ? 1 : 0))
    .map(({ __key, ...rest }) => rest);

  const canonical = {
    block: {
      length_in: Number.isFinite(blockL) ? fixed(blockL, 4) : null,
      width_in: Number.isFinite(blockW) ? fixed(blockW, 4) : null,
      height_in: Number.isFinite(blockH) ? fixed(blockH, 4) : null,
    },
    layers: layerThicknesses,
    material: {
      family: materialFamily,
      density_lb_ft3: densityLbFt3,
    },
    cavities,
  };

  const raw = stableStringify(canonical);
  return createHash("sha256").update(raw).digest("hex");
}

export function embedGeometryHashInSvg(svg: string, hash: string): string {
  if (!svg || !hash) return svg;
  const marker = "ALEX-IO-GEOMETRY-HASH:";
  if (svg.includes(marker)) return svg;
  const comment = `<!-- ${marker} ${hash} -->`;
  if (svg.startsWith("<?xml")) {
    const idx = svg.indexOf("?>");
    if (idx >= 0) return `${svg.slice(0, idx + 2)}\n${comment}${svg.slice(idx + 2)}`;
  }
  return `${comment}\n${svg}`;
}

export function embedGeometryHashInDxf(dxf: string, hash: string): string {
  if (!dxf || !hash) return dxf;
  const marker = "ALEX-IO-GEOMETRY-HASH:";
  if (dxf.includes(marker)) return dxf;
  return `999\n${marker} ${hash}\n${dxf}`;
}

export function embedGeometryHashInStep(step: string, hash: string): string {
  if (!step || !hash) return step;
  const marker = "ALEX-IO-GEOMETRY-HASH:";
  if (step.includes(marker)) return step;
  return `/* ${marker} ${hash} */\n${step}`;
}

export function buildLayoutExports(layout: LayoutLike): LayoutExportBundle {
  const hash = computeGeometryHash(layout);
  const svg = embedGeometryHashInSvg(buildSvg(layout), hash);
  const dxf = embedGeometryHashInDxf(buildDxf(layout), hash);
  const step = embedGeometryHashInStep(buildStepStub(layout), hash);
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

function norm01(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function normalizeShape(raw: any): "circle" | "rect" | "roundedRect" | "poly" | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "circle" || s === "round") return "circle";
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";
  if (s === "roundedrect" || s === "rounded-rect" || s === "rounded_rect" || s === "roundrect") return "roundedRect";
  if (s === "poly" || s === "polygon") return "poly";
  return null;
}

function coerceDiameterIn(cav: any): number | null {
  const candidates = [cav?.diameterIn, cav?.diameter_in, cav?.diameter, cav?.dia, cav?.d];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function coercePoints(cav: any): { x: number; y: number }[] | null {
  const pts = cav?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;

  const out = pts
    .map((p: any) => {
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: norm01(x), y: norm01(y) };
    })
    .filter(Boolean) as { x: number; y: number }[];

  return out.length >= 3 ? out : null;
}

function resolveCavityShape(cav: any): "circle" | "rect" | "roundedRect" | "poly" {
  // 1) points implies poly
  const pts = coercePoints(cav);
  if (pts) return "poly";

  // 2) explicit shape aliases
  const rawShape = cav?.shape ?? cav?.cavityShape ?? cav?.type ?? null;
  let shape = normalizeShape(rawShape);

  // 3) diameter implies circle unless explicitly something else
  const dia = coerceDiameterIn(cav);
  if (dia != null && dia > 0) shape = "circle";

  // 4) corner radius implies roundedRect unless circle
  const cr = Number(cav?.cornerRadiusIn ?? cav?.corner_radius_in ?? cav?.corner_radius ?? cav?.radiusIn ?? cav?.r);
  if (Number.isFinite(cr) && cr > 0 && shape !== "circle") shape = "roundedRect";

  return shape ?? "rect";
}

function resolvedPolyPoints(cav: any): { x: number; y: number }[] | null {
  return coercePoints(cav);
}

function resolvedCircleDiameterIn(cav: any): number | null {
  return coerceDiameterIn(cav);
}


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
  const parts = [`M ${firstX.toFixed(2)} ${firstY.toFixed(2)}`];

  for (let i = 1; i < mapped.length; i++) {
    const [x, y] = mapped[i];
    parts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  parts.push("Z");
  return parts.join(" ");
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

      // ✅ USE resolveCavityShape helper (matches buildDxf)
      const shape = resolveCavityShape(cav);

      if (shape === "circle") {
        const diaIn = resolvedCircleDiameterIn(cav) ?? Math.min(nnum(cav.lengthIn), nnum(cav.widthIn));
        const r = (diaIn * scale) / 2;
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

      // ✅ polygon cavity (using helper)
      if (shape === "poly") {
        const polyPts = resolvedPolyPoints(cav);
        if (polyPts && polyPts.length >= 3) {
          const pts = polyPts.map((p) => ({
            x: blockX + nnum(p.x) * blockW,
            y: blockY + nnum(p.y) * blockH,
          }));

          // label at bbox center (minimal + stable)
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;

          const pointsAttr = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
          return `
  <g>
    <polygon points="${pointsAttr}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${escapeText(label)}</text>
  </g>`;
        }
      }

      // Rectangle (with optional rounded corners)
      const rx = shape === "roundedRect" 
        ? nnum((cav as any).cornerRadiusIn ?? (cav as any).corner_radius_in ?? 0) * scale 
        : 0;
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

        const shape = resolveCavityShape(cav);

        if (shape === "circle") {
          const diaIn = resolvedCircleDiameterIn(cav) ?? Math.min(nnum(cav.lengthIn), nnum(cav.widthIn));
          const diaPx = diaIn * scale;
          const r = diaPx / 2;
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

        // polygon cavity
        if (shape === "poly") {
          const polyPts = resolvedPolyPoints(cav);
          if (polyPts && polyPts.length >= 3) {
            const pts = polyPts.map((p) => ({
              x: blockX + nnum(p.x) * blockW,
              y: blockY + nnum(p.y) * blockH,
            }));

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of pts) {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
            }
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;

            const pointsAttr = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
            return `
  <g>
    <polygon points="${pointsAttr}" fill="none" stroke="#111827" stroke-width="1" />
    <text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" fill="#111827">${escapeText(label)}</text>
  </g>`;
          }
        }

        // Rectangle (with optional rounded corners)
        const rx =
          resolveCavityShape(cav) === "roundedRect"
            ? nnum((cav as any).cornerRadiusIn ?? (cav as any).corner_radius_in ?? 0) * scale
            : 0;

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
    const shape = resolveCavityShape(cav);

    // X stays the same
    const xLeft = nnum(cav.x) * blkLen;

    // Y-FLIP (match STEP): editor y is from TOP, CAD y is from BOTTOM.
    // For rectangles: top-left at yTop = W*(1-y) - height
    // For circles: top-left box at yTop = W*(1-y) - 2r
    if (shape === "circle") {
      const diaIn = resolvedCircleDiameterIn(cav) ?? Math.min(len, wid);
      const r = diaIn / 2;

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
    } else if (shape === "poly") {
      const polyPts = resolvedPolyPoints(cav);
      if (polyPts && polyPts.length >= 3) {
        const pts: [number, number][] = polyPts.map((p) => {
          const xIn = norm01(p.x) * blkLen;
          const yIn = blkWid * (1 - norm01(p.y)); // Y-FLIP for CAD
          return [xIn, yIn];
        });

        push(0, "LWPOLYLINE");
        push(8, "CAVITY");
        push(90, pts.length);
        push(70, 1);
        for (const [px, py] of pts) {
          push(10, px);
          push(20, py);
        }
      }
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

      // Vertical stacking (match stacked SVG)
  const layerGap = 1; // inches
  const layerPitch = blkWid + layerGap; // inches


  // PATH A: visually stack full-package DXF layers vertically (like the SVG).
  // DXF units are inches here (we emit raw inch dims), so use an inch gap.
  const STACK_GAP_IN = 2; // spacing between layers in the full-package DXF

  for (let i = 0; i < stack.length; i++) {
    const layer = stack[i] || {};
    const layerNo = i + 1;
        const yOff = i * layerPitch;


    // Apply vertical offset per layer so they don't overlap.
    

    const crop = !!layer.cropCorners;
    const round = !!layer.roundCorners;
    const roundRaw = Number(layer.roundRadiusIn);
    const roundRadiusIn =
      Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : DEFAULT_ROUND_RADIUS_IN;

    const cornerStyle = !round && crop ? "chamfer" : "square";
    const chamferIn = cornerStyle === "chamfer" ? chamferInDefault : 0;

    const c =
      cornerStyle === "chamfer" && Number.isFinite(chamferIn) && chamferIn > 0
        ? Math.max(0, Math.min(chamferIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
        : 0;

    const r =
      round && Number.isFinite(roundRadiusIn) && roundRadiusIn > 0
        ? Math.max(0, Math.min(roundRadiusIn, blkLen / 2 - 1e-6, blkWid / 2 - 1e-6))
        : 0;

    const blockPts: [number, number][] =
      r > 0.0001
        ? buildOuterOutlinePolyline({
            lengthIn: blkLen,
            widthIn: blkWid,
            roundCorners: true,
            roundRadiusIn: r,
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

    // BLOCK outline on BLOCK_Ln
    push(0, "LWPOLYLINE");
    push(8, `BLOCK_L${layerNo}`);
    push(90, blockPts.length);
    push(70, 1);
    
    for (const [x, y] of blockPts) {
      push(10, x);
      push(20, y + yOff);
    }


    const cavs = Array.isArray(layer.cavities) ? (layer.cavities as CavityLike[]) : [];

    for (const cav of cavs) {
      const len = nnum(cav.lengthIn);
      const wid = nnum(cav.widthIn);
      const shape = resolveCavityShape(cav);

      if (shape === "circle") {
        const diaIn = resolvedCircleDiameterIn(cav) ?? Math.min(len, wid);
        const r = diaIn / 2;

        let x = nnum(cav.x) * blkLen;
        let yTop = blkWid * (1 - nnum(cav.y)) - (2 * r);

        // clamp inside the block
        x = Math.max(0, Math.min(blkLen - 2 * r, x));
        yTop = Math.max(0, Math.min(blkWid - 2 * r, yTop));

        const cx = x + r;
        const cy = yTop + r + yOff;

        push(0, "CIRCLE");
        push(8, `CAVITY_L${layerNo}`);
        push(10, cx);
        push(20, cy);
        push(30, 0);
        push(40, r);
      } else if (shape === "poly") {
        const polyPts = resolvedPolyPoints(cav);
        if (polyPts && polyPts.length >= 3) {
          const pts: [number, number][] = polyPts.map((p) => {
            const xIn = norm01(p.x) * blkLen;
            const yBase = blkWid * (1 - norm01(p.y));
            const yOut = yBase + yOff;
            return [xIn, yOut];
          });

          push(0, "LWPOLYLINE");
          push(8, `CAVITY_L${layerNo}`);
          push(90, pts.length);
          push(70, 1);
          for (const [px, py] of pts) {
            push(10, px);
            push(20, py);
          }
        }
      } else {
        const xLeft = nnum(cav.x) * blkLen;
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
  return "";
}
