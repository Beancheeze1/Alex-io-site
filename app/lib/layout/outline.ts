export type OutlinePoint = { x: number; y: number };

type OutlineParams = {
  lengthIn: number;
  widthIn: number;
  roundCorners: boolean;
  roundRadiusIn: number;
  segments?: number;
};

function arcPoints(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  segments: number,
): OutlinePoint[] {
  const pts: OutlinePoint[] = [];
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const step = (end - start) / Math.max(1, segments);

  for (let i = 1; i <= segments; i++) {
    const a = start + step * i;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }

  return pts;
}

export function buildOuterOutlinePolyline(params: OutlineParams): OutlinePoint[] {
  const L = Number(params.lengthIn);
  const W = Number(params.widthIn);
  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) return [];

  const segments = Number.isFinite(params.segments) && params.segments! > 0 ? params.segments! : 12;

  const wantsRound = !!params.roundCorners;
  const rRaw = Number(params.roundRadiusIn);
  const r =
    wantsRound && Number.isFinite(rRaw) && rRaw > 0
      ? Math.max(0, Math.min(rRaw, L / 2 - 1e-6, W / 2 - 1e-6))
      : 0;

  if (r <= 0) {
    return [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: W },
      { x: 0, y: W },
    ];
  }

  const pts: OutlinePoint[] = [];

  // Start on bottom edge (origin at bottom-left, y up)
  pts.push({ x: r, y: 0 });
  pts.push({ x: L - r, y: 0 });

  // Bottom-right corner
  pts.push(...arcPoints(L - r, r, r, -90, 0, segments));
  // Right edge
  pts.push({ x: L, y: W - r });
  // Top-right corner
  pts.push(...arcPoints(L - r, W - r, r, 0, 90, segments));
  // Top edge
  pts.push({ x: r, y: W });
  // Top-left corner
  pts.push(...arcPoints(r, W - r, r, 90, 180, segments));
  // Left edge
  pts.push({ x: 0, y: r });
  // Bottom-left corner
  pts.push(...arcPoints(r, r, r, 180, 270, segments));

  return pts;
}
