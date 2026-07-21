// app/lib/layout/layer-dxf.ts
//
// Server-safe per-layer DXF builder. Extracted so /api/quote/layout/dxf-layer
// can generate a single layer's DXF behind a real auth/lock check, matching
// how /api/quote/layout/step-layer already gates per-layer STEP — rather
// than computing DXF client-side with no server-side check at all (that
// remains how the admin page's own per-layer DXF button works today; this
// module does not change that, it's a separate server-side path used by the
// customer-facing page).

import { buildOuterOutlinePolyline } from "./outline";

export type LayoutLayer = {
  id?: string;
  label?: string;
  name?: string;
  title?: string;
  thicknessIn?: number;
  thickness_in?: number;
  thickness?: number;
  cavities?: any[];
};

export type FlatCavity = {
  lengthIn: number;
  widthIn: number;
  depthIn: number | null;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  shape?: "rect" | "circle" | "roundedRect" | "poly" | null;
  diameterIn?: number | null;
  cornerRadiusIn?: number | null;
  points?: { x: number; y: number }[] | null;
};

export type TargetDimsIn = { L: number; W: number };

function arcEntity(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  return [
    "0", "ARC",
    "8", "0",
    "10", cx.toFixed(4),
    "20", cy.toFixed(4),
    "30", "0.0",
    "40", r.toFixed(4),
    "50", startDeg.toFixed(4),
    "51", endDeg.toFixed(4),
  ].join("\n");
}

function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
  return [
    "0", "LINE",
    "8", "0",
    "10", x1.toFixed(4),
    "20", y1.toFixed(4),
    "30", "0.0",
    "11", x2.toFixed(4),
    "21", y2.toFixed(4),
    "31", "0.0",
  ].join("\n");
}

function emitRoundedRectDXF(entities: string[], x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const x2 = x + w;
  const y2 = y + h;

  entities.push(lineEntity(x + rr, y, x2 - rr, y));
  entities.push(lineEntity(x2, y + rr, x2, y2 - rr));
  entities.push(lineEntity(x2 - rr, y2, x + rr, y2));
  entities.push(lineEntity(x, y2 - rr, x, y + rr));

  entities.push(arcEntity(x2 - rr, y + rr, rr, 270, 360));
  entities.push(arcEntity(x2 - rr, y2 - rr, rr, 0, 90));
  entities.push(arcEntity(x + rr, y2 - rr, rr, 90, 180));
  entities.push(arcEntity(x + rr, y + rr, rr, 180, 270));
}

function normalizeShape(raw: any): "rect" | "circle" | "roundedRect" | "poly" | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;
  if (s === "circle" || s === "round" || s === "circular") return "circle";
  if (s === "roundedrect" || s === "rounded-rect" || s === "rounded_rectangle" || s === "rounded rectangle")
    return "roundedRect";
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";
  return null;
}

export function getLayersFromLayout(layout: any): LayoutLayer[] {
  if (!layout || typeof layout !== "object") return [];
  if (Array.isArray(layout.stack) && layout.stack.length > 0) return layout.stack as LayoutLayer[];
  if (Array.isArray(layout.layers) && layout.layers.length > 0) return layout.layers as LayoutLayer[];
  if (Array.isArray((layout as any).foamLayers) && (layout as any).foamLayers.length > 0) {
    return (layout.foamLayers as any[]) as LayoutLayer[];
  }
  return [];
}

export function getCavitiesForLayer(layout: any, layerIndex: number): FlatCavity[] {
  const out: FlatCavity[] = [];
  if (!layout || typeof layout !== "object") return out;

  const layers = getLayersFromLayout(layout);
  if (!Array.isArray(layers) || layers.length === 0) return out;

  const layer = layers[layerIndex];
  if (!layer || !Array.isArray(layer.cavities)) return out;

  for (const cav of layer.cavities) {
    if (!cav) continue;

    const lengthIn = Number((cav as any).lengthIn);
    const widthIn = Number((cav as any).widthIn);
    const depthInRaw = (cav as any).depthIn;
    const depthIn = depthInRaw == null ? null : Number(depthInRaw);

    const x = Number((cav as any).x);
    const y = Number((cav as any).y);

    if (!Number.isFinite(lengthIn) || lengthIn <= 0) continue;
    const w = Number.isFinite(widthIn) && widthIn > 0 ? widthIn : lengthIn;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue;

    const hasPoints = Array.isArray((cav as any).points) && (cav as any).points.length >= 3;
    const shape = hasPoints
      ? "poly"
      : normalizeShape(
          (cav as any).shape ??
            (cav as any).cavityShape ??
            (cav as any).cavity_shape ??
            (cav as any).type ??
            (cav as any).kind,
        );

    const rawDia = (cav as any).diameterIn ?? (cav as any).diameter_in ?? (cav as any).diameter ?? null;
    const diaNum = rawDia == null ? NaN : Number(rawDia);
    const diameterIn =
      shape === "circle" ? (Number.isFinite(diaNum) && diaNum > 0 ? diaNum : Math.min(lengthIn, w)) : null;

    const rawR =
      (cav as any).cornerRadiusIn ?? (cav as any).corner_radius_in ?? (cav as any).cornerRadius ?? (cav as any).r ?? null;
    const rNum = rawR == null ? NaN : Number(rawR);
    const cornerRadiusIn = Number.isFinite(rNum) && rNum > 0 ? rNum : null;

    const points = hasPoints ? (cav as any).points : null;

    out.push({
      lengthIn,
      widthIn: w,
      depthIn: Number.isFinite(depthIn as any) ? depthIn : null,
      x,
      y,
      shape: shape ?? null,
      diameterIn: diameterIn ?? null,
      cornerRadiusIn,
      points,
    });
  }

  return out;
}

/**
 * Build a DXF for a single layer: foam outline rectangle (or chamfered/rounded
 * per that layer's own corner flags) + that layer's own cavities only.
 * Mirrors the admin page's client-side buildDxfForLayer output.
 */
export function buildDxfForLayer(layout: any, layerIndex: number, targetDimsIn?: TargetDimsIn): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  const rawL = Number(block.lengthIn ?? block.length_in);
  const rawW = Number(block.widthIn ?? block.width_in);

  if (!Number.isFinite(rawL) || rawL <= 0) return null;
  const fallbackW = Number.isFinite(rawW) && rawW > 0 ? rawW : rawL;

  let scale = 1;
  if (targetDimsIn && Number.isFinite(targetDimsIn.L) && targetDimsIn.L > 0 && Number.isFinite(rawL) && rawL > 0) {
    scale = targetDimsIn.L / rawL;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  }

  const L = rawL * scale;
  const W = fallbackW * scale;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntityLocal(x1: number, y1: number, x2: number, y2: number): string {
    return ["0", "LINE", "8", "0", "10", fmt(x1), "20", fmt(y1), "30", "0.0", "11", fmt(x2), "21", fmt(y2), "31", "0.0"].join(
      "\n",
    );
  }

  function emitPolyline(points: { x: number; y: number }[]) {
    if (points.length < 2) return;
    entities.push(["0", "LWPOLYLINE", "8", "0", "90", String(points.length), "70", "1"].join("\n"));
    for (const pt of points) {
      entities.push(["10", fmt(pt.x), "20", fmt(pt.y)].join("\n"));
    }
  }

  const entities: string[] = [];

  const stackArr: any[] | null = Array.isArray((layout as any)?.stack)
    ? ((layout as any).stack as any[])
    : Array.isArray((layout as any)?.layers)
      ? ((layout as any).layers as any[])
      : null;

  const hasLayers = Array.isArray(stackArr) && stackArr.length > 0;
  const layer = hasLayers ? stackArr![layerIndex] : null;

  const layerCrop = !!(
    layer?.cropCorners ??
    layer?.croppedCorners ??
    layer?.cropped_corners ??
    layer?.cornerStyle === "chamfer"
  );
  const layerRound = !!(layer?.roundCorners ?? layer?.round_corners);
  const roundRadiusRaw = layer?.roundRadiusIn ?? layer?.round_radius_in ?? layer?.round_radius ?? null;
  const roundRadiusIn = Number.isFinite(Number(roundRadiusRaw)) && Number(roundRadiusRaw) > 0 ? Number(roundRadiusRaw) : 0.25;

  const cornerStyleLegacy = String((layout as any)?.block?.cornerStyle ?? (layout as any)?.block?.corner_style ?? "").toLowerCase();
  const croppedLegacy = !!((layout as any)?.block?.croppedCorners ?? (layout as any)?.block?.cropped_corners);

  const wantsRound = hasLayers ? layerRound : false;
  const wantsChamfer = !wantsRound && (hasLayers ? layerCrop : cornerStyleLegacy === "chamfer" || croppedLegacy);

  const chamferInRaw = (layout as any)?.block?.chamferIn ?? (layout as any)?.block?.chamfer_in;
  const chamferInNum = chamferInRaw == null ? NaN : Number(chamferInRaw);
  const chamferIn = Number.isFinite(chamferInNum) && chamferInNum > 0 ? chamferInNum : 1;

  const chamferScaled = wantsChamfer
    ? Math.max(0, Math.min(chamferIn * scale, L / 2 - 1e-6, W / 2 - 1e-6))
    : 0;

  const roundScaled = wantsRound ? Math.max(0, Math.min(roundRadiusIn * scale, L / 2 - 1e-6, W / 2 - 1e-6)) : 0;

  if (roundScaled > 0.0001) {
    const pts = buildOuterOutlinePolyline({
      lengthIn: L,
      widthIn: W,
      roundCorners: true,
      roundRadiusIn: roundScaled,
      segments: 12,
    });
    emitPolyline(pts);
  } else if (chamferScaled > 0.0001) {
    const c = chamferScaled;
    entities.push(lineEntityLocal(0, 0, L - c, 0));
    entities.push(lineEntityLocal(L - c, 0, L, c));
    entities.push(lineEntityLocal(L, c, L, W));
    entities.push(lineEntityLocal(L, W, c, W));
    entities.push(lineEntityLocal(c, W, 0, W - c));
    entities.push(lineEntityLocal(0, W - c, 0, 0));
  } else {
    entities.push(lineEntityLocal(0, 0, L, 0));
    entities.push(lineEntityLocal(L, 0, L, W));
    entities.push(lineEntityLocal(L, W, 0, W));
    entities.push(lineEntityLocal(0, W, 0, 0));
  }

  const cavs = getCavitiesForLayer(layout, layerIndex);

  for (const cav of cavs) {
    const cL = cav.lengthIn;
    const cW = cav.widthIn;

    const x0 = L * cav.x;
    const ySvgTop = W * cav.y;
    const y0 = W - ySvgTop - cW;

    const left = Math.max(0, Math.min(L - cL, x0));
    const bottom = Math.max(0, Math.min(W - cW, y0));

    if (cav.shape === "circle") {
      const dia = cav.diameterIn && cav.diameterIn > 0 ? cav.diameterIn : Math.min(cL, cW);
      const r = dia / 2;
      const cx = left + cL / 2;
      const cy = bottom + cW / 2;
      entities.push(["0", "CIRCLE", "8", "0", "10", fmt(cx), "20", fmt(cy), "30", "0.0", "40", fmt(r)].join("\n"));
      continue;
    }

    if (cav.shape === "poly" && Array.isArray(cav.points) && cav.points.length >= 3) {
      const rawPts = cav.points;
      const pts: [number, number][] = rawPts.map((p) => {
        const px = Math.max(0, Math.min(1, Number(p?.x)));
        const py = Math.max(0, Math.min(1, Number(p?.y)));
        const x = px * L;
        const y = (1 - py) * W;
        return [x, y];
      });

      entities.push(
        [
          "0", "LWPOLYLINE",
          "8", "0",
          "90", String(pts.length),
          "70", "1",
          ...pts.flatMap(([x, y]) => ["10", fmt(x), "20", fmt(y)]),
        ].join("\n"),
      );
      continue;
    }

    if ((cav.shape === "roundedRect" || cav.cornerRadiusIn) && cav.cornerRadiusIn) {
      emitRoundedRectDXF(entities, left, bottom, cL, cW, cav.cornerRadiusIn);
      continue;
    }

    entities.push(lineEntityLocal(left, bottom, left + cL, bottom));
    entities.push(lineEntityLocal(left + cL, bottom, left + cL, bottom + cW));
    entities.push(lineEntityLocal(left + cL, bottom + cW, left, bottom + cW));
    entities.push(lineEntityLocal(left, bottom + cW, left, bottom));
  }

  if (!entities.length) return null;

  const header = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "1",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "ENDSEC",
    "0", "SECTION", "2", "BLOCKS",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ].join("\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\n");

  return [header, entities.join("\n"), footer].join("\n");
}
