import { CavityShape, LayoutModel, formatCavityLabel } from "@/app/quote/layout/editor/layoutTypes";

type Pt = { x: number; y: number };

function bbox(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function centroidMean(pts: Pt[]) {
  let sx = 0, sy = 0, n = 0;
  for (const p of pts) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    n += 1;
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

function uniqSorted(vals: number[], tol = 1e-6) {
  const v = vals.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of v) {
    if (!out.length) out.push(x);
    else {
      const last = out[out.length - 1];
      if (Math.abs(x - last) > tol) out.push(x);
    }
  }
  return out;
}

function detectChamferOuter(outerPts: Pt[]) {
  // Detect an axis-aligned rectangle with 45 chamfers (8 vertices typical)
  if (outerPts.length < 6) return null;

  const xs = uniqSorted(outerPts.map((p) => p.x));
  const ys = uniqSorted(outerPts.map((p) => p.y));

  // Classic chamfered rectangle tends to have 4 unique x and 4 unique y
  if (xs.length !== 4 || ys.length !== 4) return null;

  const minX = xs[0], x2 = xs[1], x3 = xs[2], maxX = xs[3];
  const minY = ys[0], y2 = ys[1], y3 = ys[2], maxY = ys[3];

  const runX1 = x2 - minX;
  const runX2 = maxX - x3;
  const runY1 = y2 - minY;
  const runY2 = maxY - y3;

  const runs = [runX1, runX2, runY1, runY2].filter((n) => Number.isFinite(n) && n > 0);
  if (runs.length !== 4) return null;

  // Runs should be roughly equal for 45 chamfer; allow some tolerance
  const minRun = Math.min(...runs);
  const maxRun = Math.max(...runs);
  if (minRun <= 0) return null;
  if (maxRun / minRun > 1.25) return null;

  // Use the smallest run as the chamfer run
  return { chamferIn: minRun };
}

function detectCircle(loopPts: Pt[]) {
  // Use mean centroid + radius variance test; require enough samples
  if (loopPts.length < 12) return null;

  const c = centroidMean(loopPts);
  if (!c) return null;

  const rs: number[] = [];
  for (const p of loopPts) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const r = Math.hypot(dx, dy);
    if (Number.isFinite(r) && r > 0) rs.push(r);
  }
  if (rs.length < 12) return null;

  const mean = rs.reduce((s, x) => s + x, 0) / rs.length;
  if (!Number.isFinite(mean) || mean <= 0) return null;

  let varSum = 0;
  for (const r of rs) varSum += (r - mean) * (r - mean);
  const stdev = Math.sqrt(varSum / rs.length);

  // Circle if radius is very consistent
  if (stdev / mean > 0.02) return null;

  return { cx: c.x, cy: c.y, r: mean, diameter: mean * 2 };
}

function snapPretty(n: number) {
  // Match editor label behavior: avoid float junk
  const rounded = Math.round(n * 1000) / 1000;
  return rounded;
}

export function facesJsonToLayoutSeed(facesJson: any): LayoutModel {
  const loopsRaw = Array.isArray(facesJson?.loops) ? facesJson.loops : [];
  const outerIdxRaw = Number(facesJson?.outerLoopIndex);
  const outerIdx = Number.isFinite(outerIdxRaw) ? outerIdxRaw : 0;

  const toPts = (loop: any): Pt[] => {
    const pts = Array.isArray(loop?.points) ? loop.points : [];
    return pts
      .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
  };

  const outerLoop = loopsRaw[outerIdx];
  const outerPts = toPts(outerLoop);
  const outerBB = bbox(outerPts);

  // Safe fallback
  const fallback: LayoutModel = {
    block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 },
    cavities: [],
    stack: [
      { id: "seed-layer-1", label: "Layer 1", thicknessIn: 2, cavities: [] },
    ],
  };

  if (!outerBB || outerBB.w <= 0 || outerBB.h <= 0) return fallback;

  const blockLengthIn = snapPretty(outerBB.w);
  const blockWidthIn = snapPretty(outerBB.h);
  const blockThicknessIn = 2; // unchanged default behavior here

  const block: LayoutModel["block"] = {
    lengthIn: blockLengthIn,
    widthIn: blockWidthIn,
    thicknessIn: blockThicknessIn,
  };

  // Detect chamfered outside corners (cropped-corner block)
  const chamfer = detectChamferOuter(outerPts);
  if (chamfer && chamfer.chamferIn > 0) {
    block.cornerStyle = "chamfer";
    block.chamferIn = snapPretty(chamfer.chamferIn);
  }

  const cavities: LayoutModel["cavities"] = [];

  for (let i = 0; i < loopsRaw.length; i++) {
    if (i === outerIdx) continue;

    const pts = toPts(loopsRaw[i]);
    if (pts.length < 3) continue;

    const bb = bbox(pts);
    if (!bb || bb.w <= 0 || bb.h <= 0) continue;

    // Determine center for placement
    const cMean = centroidMean(pts) ?? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };

    const circle = detectCircle(pts);

    let shape: CavityShape = "rect";
    let lengthIn = snapPretty(bb.w);
    let widthIn = snapPretty(bb.h);
    let cornerRadiusIn = 0;

    if (circle) {
      shape = "circle";
      lengthIn = snapPretty(circle.diameter);
      widthIn = lengthIn;
    } else {
      // Rect stays rect; roundedRect is not inferred here (Path A minimal)
      shape = "rect";
    }

    const depthIn = 1;

    // Placement is normalized [0..1] relative to outer bbox origin.
    // NOTE: faces adapter already translates minX/minY to ~0; we still reference outerBB for safety.
    const x = (cMean.x - outerBB.minX) / Math.max(1e-9, outerBB.w);
    const y = (cMean.y - outerBB.minY) / Math.max(1e-9, outerBB.h);

    const label = formatCavityLabel({
      shape,
      lengthIn,
      widthIn,
      depthIn,
    });

    cavities.push({
      id: `seed-cav-${cavities.length + 1}`,
      label,
      shape,
      cornerRadiusIn,
      lengthIn,
      widthIn,
      depthIn,
      x,
      y,
    });
  }

  const stackCavs = cavities.map((c) => ({ ...c }));

  return {
    block,
    cavities: cavities.map((c) => ({ ...c })),
    stack: [
      {
        id: "seed-layer-1",
        label: "Layer 1",
        thicknessIn: blockThicknessIn,
        cavities: stackCavs,
      },
    ],
  };
}
