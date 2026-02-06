// lib/forgeFacesSeed.ts

import { CavityShape, LayoutModel, formatCavityLabel } from "@/app/quote/layout/editor/layoutTypes";

type Pt = { x: number; y: number };

function bbox(pts: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const p of pts) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  )
    return null;

  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function centroidMean(pts: Pt[]) {
  let sx = 0,
    sy = 0,
    n = 0;

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
  const v = vals
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);

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
  // Detect an axis-aligned rectangle with 45 chamfers
  // Can have 6 points (simplified) or 8 points (classic)
  console.log("🔍 detectChamferOuter called with", outerPts.length, "points");

  if (outerPts.length < 6) {
    console.log("❌ Too few points (<6)");
    return null;
  }

  const xs = uniqSorted(outerPts.map((p) => p.x));
  const ys = uniqSorted(outerPts.map((p) => p.y));

  console.log("Unique X coords:", xs.length, xs);
  console.log("Unique Y coords:", ys.length, ys);

  // For 6-point chamfered rectangle: 3 unique X, 3 unique Y
  // For 8-point chamfered rectangle: 4 unique X, 4 unique Y
  const is6Point = xs.length === 3 && ys.length === 3;
  const is8Point = xs.length === 4 && ys.length === 4;

  if (!is6Point && !is8Point) {
    console.log("❌ Not 3x3 or 4x4 unique coords (need chamfer pattern)");
    return null;
  }

  if (is6Point) {
    const minX = xs[0],
      midX = xs[1],
      maxX = xs[2];
    const minY = ys[0],
      midY = ys[1],
      maxY = ys[2];

    const chamferX1 = midX - minX;
    const chamferX2 = maxX - midX;
    const chamferY1 = midY - minY;
    const chamferY2 = maxY - midY;

    const runs = [chamferX1, chamferX2, chamferY1, chamferY2]
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    console.log("6-point chamfer runs (sorted):", runs);

    if (runs.length < 2) {
      console.log("❌ Not enough valid runs");
      return null;
    }

    const smallRuns = runs.slice(0, 2);
    const avgChamfer = (smallRuns[0] + smallRuns[1]) / 2;

    const ratio = smallRuns[1] / smallRuns[0];
    console.log("Small runs ratio:", {
      run1: smallRuns[0],
      run2: smallRuns[1],
      ratio,
      avgChamfer,
    });

    if (ratio > 2.0) {
      console.log("❌ Runs too inconsistent (ratio > 2.0)");
      return null;
    }

    console.log("✅ 6-point chamfer detected! Size:", avgChamfer);
    return { chamferIn: avgChamfer };
  }

  // 8-point pattern: classic chamfers
  const minX = xs[0],
    x2 = xs[1],
    x3 = xs[2],
    maxX = xs[3];
  const minY = ys[0],
    y2 = ys[1],
    y3 = ys[2],
    maxY = ys[3];

  const runX1 = x2 - minX;
  const runX2 = maxX - x3;
  const runY1 = y2 - minY;
  const runY2 = maxY - y3;

  const runs = [runX1, runX2, runY1, runY2].filter(
    (n) => Number.isFinite(n) && n > 0
  );

  console.log("8-point chamfer runs:", {
    runX1,
    runX2,
    runY1,
    runY2,
    validRuns: runs.length,
  });

  if (runs.length !== 4) {
    console.log("❌ Not all 4 runs are valid");
    return null;
  }

  const minRun = Math.min(...runs);
  const maxRun = Math.max(...runs);
  const ratio = maxRun / minRun;

  console.log("8-point run consistency:", { minRun, maxRun, ratio, threshold: 1.25 });

  if (minRun <= 0) return null;
  if (ratio > 1.25) return null;

  console.log("✅ 8-point chamfer detected! Size:", minRun);
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

function snapPretty(n: number, units: "in" | "mm" = "in"): number {
  // Convert mm to inches if needed
  let val = n;
  if (units === "mm") {
    val = n / 25.4;
  }

  // Round to nearest 1/16"
  const sixteenths = Math.round(val * 16);
  const rounded = sixteenths / 16;

  // Snap near whole
  const whole = Math.round(rounded);
  if (Math.abs(rounded - whole) < 0.01) {
    return whole;
  }

  const eighths = Math.round(val * 8) / 8;
  if (Math.abs(val - eighths) < 0.005) return eighths;

  const quarters = Math.round(val * 4) / 4;
  if (Math.abs(val - quarters) < 0.005) return quarters;

  const halves = Math.round(val * 2) / 2;
  if (Math.abs(val - halves) < 0.005) return halves;

  return rounded;
}

// Helper: point-in-polygon test
function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function facesJsonToLayoutSeed(facesJson: any): LayoutModel {
  const faces = facesJson ?? {};
  const units = (faces?.units as "in" | "mm") || "in";
  const loopsRaw = Array.isArray(faces?.loops) ? faces.loops : [];
  const outerIdxRaw = Number(faces?.outerLoopIndex);
  const outerIdx =
    Number.isFinite(outerIdxRaw) && outerIdxRaw >= 0 && outerIdxRaw < loopsRaw.length
      ? outerIdxRaw
      : 0;

  const toPts = (loop: any): Pt[] => {
    const pts = Array.isArray(loop?.points) ? loop.points : [];
    return pts
      .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
  };

  // Safe fallback
  const fallback: LayoutModel = {
    block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 },
    cavities: [],
    stack: [{ id: "seed-layer-1", label: "Layer 1", thicknessIn: 2, cavities: [] }],
  };

  if (!loopsRaw.length) return fallback;

  const outerPts = toPts(loopsRaw[outerIdx]);
  if (!outerPts.length) return fallback;

  // --- Compute block bounding box from outer loop ---
  let outerMinX = Infinity;
  let outerMinY = Infinity;
  let outerMaxX = -Infinity;
  let outerMaxY = -Infinity;

  for (const p of outerPts) {
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    outerMinX = Math.min(outerMinX, x);
    outerMinY = Math.min(outerMinY, y);
    outerMaxX = Math.max(outerMaxX, x);
    outerMaxY = Math.max(outerMaxY, y);
  }

  const blockLen = outerMaxX - outerMinX;
  const blockWid = outerMaxY - outerMinY;

  if (!Number.isFinite(blockLen) || !Number.isFinite(blockWid) || blockLen <= 0 || blockWid <= 0) {
    return fallback;
  }

  const blockLengthIn = snapPretty(blockLen, units);
  const blockWidthIn = snapPretty(blockWid, units);
  const blockThicknessIn = 2; // unchanged default behavior

  const block: LayoutModel["block"] = {
    lengthIn: blockLengthIn,
    widthIn: blockWidthIn,
    thicknessIn: blockThicknessIn,
  };

  // Detect chamfered outside corners (cropped-corner block)
  const chamfer = detectChamferOuter(outerPts);
  console.log("🔍 Chamfer detection:", {
    outerPointsCount: outerPts.length,
    chamferDetected: !!chamfer,
    chamferSize: chamfer?.chamferIn,
    outerPoints: outerPts,
  });

  if (chamfer && chamfer.chamferIn > 0) {
    block.cornerStyle = "chamfer";
    block.chamferIn = snapPretty(chamfer.chamferIn, units);
    console.log("✅ Chamfer applied:", block.chamferIn, "inches");
  } else {
    console.log("❌ No chamfer detected - using square corners");
  }

  const cavities: LayoutModel["cavities"] = [];

  // Helper: normalize points to editor space
  function normalizePoints(pts: Pt[]): { x: number; y: number }[] {
    return pts
      .map((p) => {
        const xIn = p.x - outerMinX;
        const yIn = p.y - outerMinY;
        const xN = blockLen > 0 ? xIn / blockLen : 0;
        const yN = blockWid > 0 ? 1 - yIn / blockWid : 0; // TOP-LEFT normalization
        return {
          x: xN < 0 ? 0 : xN > 1 ? 1 : xN,
          y: yN < 0 ? 0 : yN > 1 ? 1 : yN,
        };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  // STEP 1: Identify nested relationships (which loops are inside which)
  const nestedInside = new Map<number, number[]>();

  for (let i = 0; i < loopsRaw.length; i++) {
    if (i === outerIdx) continue;

    const iLoop = loopsRaw[i];
    const iArea = typeof iLoop?.area === "number" ? iLoop.area : 0;

    // Only positive-area loops can be nested cutouts (holes within holes)
    if (iArea <= 0) continue;

    const iPts = toPts(iLoop);
    if (iPts.length < 3) continue;

    const iCenter: Pt = {
      x: iPts.reduce((sum, p) => sum + p.x, 0) / iPts.length,
      y: iPts.reduce((sum, p) => sum + p.y, 0) / iPts.length,
    };

    // Find which negative-area loop (cavity) contains this positive loop
    for (let j = 0; j < loopsRaw.length; j++) {
      if (j === outerIdx || j === i) continue;

      const jLoop = loopsRaw[j];
      const jArea = typeof jLoop?.area === "number" ? jLoop.area : 0;

      // Parent must be a cavity (negative area)
      if (jArea >= 0) continue;

      const jPts = toPts(jLoop);
      if (jPts.length < 3) continue;

      if (pointInPoly(iCenter, jPts)) {
        if (!nestedInside.has(j)) {
          nestedInside.set(j, []);
        }
        nestedInside.get(j)!.push(i);
        console.log(
          `🔗 Nested detected: Loop ${i} (area=${iArea.toFixed(
            6
          )}) inside Loop ${j} (area=${jArea.toFixed(6)})`
        );
        break;
      }
    }
  }

  // STEP 2: Build set of loops that are nested (so we can skip them as top-level cavities)
  const nestedLoopIndices = new Set<number>();
  for (const children of nestedInside.values()) {
    for (const childIdx of children) {
      nestedLoopIndices.add(childIdx);
    }
  }

  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // STEP 3: Process each loop as a cavity (skipping nested ones)
  for (let i = 0; i < loopsRaw.length; i++) {
    if (i === outerIdx) continue;

    if (nestedLoopIndices.has(i)) {
      console.log(`⏭️  Skipping Loop ${i} (nested cavity, will be added to parent)`);
      continue;
    }

    const pts = toPts(loopsRaw[i]);
    if (pts.length < 3) continue;

    const bb = bbox(pts);
    if (!bb || bb.w <= 0 || bb.h <= 0) continue;

    // Determine center for placement
    const cMean: Pt = {
      x: (bb.minX + bb.maxX) / 2,
      y: (bb.minY + bb.maxY) / 2,
    };

    const circle = detectCircle(pts);

    let shape: CavityShape = "rect";
    let lengthIn = snapPretty(bb.w, units);
    let widthIn = snapPretty(bb.h, units);
    const cornerRadiusIn = 0;

    let polyPoints: { x: number; y: number }[] | undefined = undefined;

    if (circle) {
      shape = "circle";
      lengthIn = snapPretty(circle.diameter, units);
      widthIn = lengthIn;
    } else {
      // Preserve true cavity outline as a polygon
      shape = "poly";
      polyPoints = normalizePoints(pts);
      if (!polyPoints || polyPoints.length < 3) continue;
    }

    const depthIn = 1;

    // --- REQUIRED for your new placement block: define cavCenter*_in ---
    const cavCenterX_plan = cMean.x;
    const cavCenterY_plan = cMean.y;
    const cavCenterX_in = cavCenterX_plan - outerMinX;
    const cavCenterY_in = cavCenterY_plan - outerMinY;

    // Normalize for editor (InteractiveCanvas expects TOP-LEFT normalized)
    const cavLeft_in = cavCenterX_in - lengthIn / 2;
    const cavTop_in = cavCenterY_in + widthIn / 2; // because we later flip to top-origin

    const xRaw = blockLen > 0 ? cavLeft_in / blockLen : 0.0;
    const yRaw = blockWid > 0 ? 1 - cavTop_in / blockWid : 0.0;

    const x = clamp01(xRaw);
    const y = clamp01(yRaw);

    const label = formatCavityLabel({
      shape,
      lengthIn,
      widthIn,
      depthIn,
    });

    // Build the cavity object
    const cavity: any = {
      id: `seed-cav-${cavities.length + 1}`,
      label,
      shape,
      cornerRadiusIn,
      lengthIn,
      widthIn,
      depthIn,
      x,
      y,
    };

    // Add main points for poly shapes
    if (shape === "poly" && polyPoints && polyPoints.length >= 3) {
      cavity.points = polyPoints;
    }

    // STEP 4: Add nested cavities if this loop has any
    const nestedLoopIdxs = nestedInside.get(i);
    if (nestedLoopIdxs && nestedLoopIdxs.length > 0) {
      cavity.nestedCavities = nestedLoopIdxs
        .map((nestedIdx) => {
          const nestedPts = toPts(loopsRaw[nestedIdx]);
          const nestedNorm = normalizePoints(nestedPts);
          if (!nestedNorm || nestedNorm.length < 3) return null;
          return { points: nestedNorm };
        })
        .filter(Boolean);
      console.log(`✨ Added ${nestedLoopIdxs.length} nested cavity/cavities to Loop ${i}`);
    }

    cavities.push(cavity);
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
