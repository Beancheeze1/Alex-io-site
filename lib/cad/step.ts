// lib/cad/step.ts
//
// STEP export helper (Path A, v5).
//
// v5 goal (stability-first):
//   - Emit a valid STEP file that contains:
//       * One BLOCK solid representing the foam block.
//       * Optional BLOCK solids for each cavity (as separate solids),
//         positioned correctly in 3D.
//   - NO BOOLEAN_RESULT / CSG_SOLID (some viewers choke on those).
//   - Geometry is emitted in millimeters (mm), converted from inches.
//   - Header + metadata stay stable so we can iterate later.
//
// Notes:
//   - We keep this helper self-contained and pure: no DB, no Next APIs.
//   - The calling route is responsible for passing layout + metadata.
//   - Cavities are represented as rectangular solids for visualization;
//     they are NOT “cut out” of the block in this version.

import type { LayoutModel } from "@/app/quote/layout/editor/layoutTypes";

export type StepBuildOptions = {
  quoteNo?: string | null;
  materialLegend?: string | null;
};

/* ===================== Layout helpers ===================== */

type FlatCavity = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number; // normalized 0..1 from left
  y: number; // normalized 0..1 from top
};

/**
 * Extract basic block dimensions from the layout.
 * Falls back safely if the layout is malformed.
 */
function getBlockDims(layout: any): {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
} | null {
  if (!layout || typeof layout !== "object") return null;

  const block = (layout as LayoutModel).block as any;
  if (!block || typeof block !== "object") return null;

  const rawL = (block as any).lengthIn ?? (block as any).length_in;
  const rawW = (block as any).widthIn ?? (block as any).width_in;
  const rawT = (block as any).thicknessIn ?? (block as any).thickness_in;

  const L = Number(rawL);
  const W = Number(rawW);
  const T = Number(rawT);

  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(T)) {
    return null;
  }
  if (L <= 0 || W <= 0 || T <= 0) {
    return null;
  }

  return { lengthIn: L, widthIn: W, thicknessIn: T };
}

/**
 * Gather all cavities from a layout in a backward-compatible way.
 *
 * Supports:
 *  - Legacy single-layer layouts:
 *      layout.cavities = [...]
 *  - Multi-layer layouts:
 *      layout.stack = [{ cavities: [...] }, ...]
 *
 * If both are present, we include both sets.
 */
function getAllCavitiesFromLayout(layout: any): FlatCavity[] {
  const out: FlatCavity[] = [];

  if (!layout || typeof layout !== "object") return out;

  const pushFrom = (cavs: any[]) => {
    for (const cav of cavs) {
      if (!cav) continue;

      const lengthIn = Number((cav as any).lengthIn);
      const widthIn = Number((cav as any).widthIn);
      const depthIn = Number((cav as any).depthIn);
      const x = Number((cav as any).x);
      const y = Number((cav as any).y);

      if (!Number.isFinite(lengthIn) || lengthIn <= 0) continue;
      if (!Number.isFinite(widthIn) || widthIn <= 0) continue;
      if (!Number.isFinite(depthIn) || depthIn <= 0) continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || x > 1 || y < 0 || y > 1) continue;

      out.push({ lengthIn, widthIn, depthIn, x, y });
    }
  };

  if (Array.isArray((layout as any).cavities)) {
    pushFrom((layout as any).cavities);
  }

  if (Array.isArray((layout as any).stack)) {
    for (const layer of (layout as any).stack) {
      if (layer && Array.isArray((layer as any).cavities)) {
        pushFrom((layer as any).cavities);
      }
    }
  }

  return out;
}

/* ===================== STEP formatting helpers ===================== */

/**
 * Escape a string for use inside a STEP string literal.
 * STEP uses single quotes and doubles them for escaping.
 */
function stepStringLiteral(input: string): string {
  const safe = input.replace(/'/g, "''");
  return `'${safe}'`;
}

/**
 * Format a numeric length for STEP (we'll use mm internally).
 */
function fmtLen(n: number): string {
  if (!Number.isFinite(n)) return "0.";
  // 6 decimals is plenty for our use; trim trailing zeros & dot.
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.`;
}

/* ===================== Main STEP builder ===================== */

/**
 * Build a **valid STEP file** for a foam layout.
 *
 * Geometry:
 *   - Single BLOCK solid representing the full foam block:
 *       size L x W x T (in inches) → mm.
 *   - Each cavity becomes a BLOCK solid representing its volume:
 *       length x width x depth, positioned using normalized x/y and depth.
 *   - All solids are listed in a SHAPE_REPRESENTATION:
 *       items = (foam_block, cavity_1, cavity_2, ...)
 *
 * Assumptions:
 *   - X axis = block length direction.
 *   - Y axis = block width direction.
 *   - Z axis = thickness, 0 at bottom, +Z up.
 *   - Layout's normalized (x,y) is measured from top-left, so:
 *       left_in = x * lengthIn
 *       top_in  = y * widthIn
 *     and cavities are positioned cutting downward from the *top* surface.
 */
export function buildStepFromLayout(
  layout: any,
  opts: StepBuildOptions = {},
): string | null {
  const block = getBlockDims(layout);
  if (!block) {
    // If we can't even read block dims, bail out so we don't store junk.
    return null;
  }

  const { lengthIn, widthIn, thicknessIn } = block;
  const quoteNo = (opts.quoteNo ?? "").trim() || null;
  const materialLegend =
    opts.materialLegend && opts.materialLegend.trim().length > 0
      ? opts.materialLegend.trim()
      : null;

  const cavities = getAllCavitiesFromLayout(layout);

  // Build a human-readable description for FILE_DESCRIPTION.
  const descParts: string[] = [];
  descParts.push(
    `Foam block ${lengthIn} x ${widthIn} x ${thicknessIn} in`,
  );
  if (cavities.length > 0) {
    descParts.push(`Cavities (as solids): ${cavities.length}`);
  }
  if (quoteNo) {
    descParts.push(`Quote ${quoteNo}`);
  }
  if (materialLegend) {
    descParts.push(materialLegend);
  }
  const description = descParts.join(" | ");

  // If we somehow have no geometry at all, bail.
  if (!(lengthIn > 0 && widthIn > 0 && thicknessIn > 0)) {
    return null;
  }

  // File name: use quote number if available.
  const safeQuoteForFile =
    quoteNo?.replace(/[^A-Za-z0-9_\-]+/g, "_") || "foam_block";
  const fileName = `${safeQuoteForFile}.step`;

  // ISO timestamp for FILE_NAME.
  const nowIso = new Date().toISOString();

  // Convert inches -> millimeters for actual geometry.
  const mmPerInch = 25.4;
  const Lmm = lengthIn * mmPerInch;
  const Wmm = widthIn * mmPerInch;
  const Tmm = thicknessIn * mmPerInch;

  // Simple id generator for STEP entities.
  let nextId = 1;
  const ents: string[] = [];

  const id = () => nextId++;

  // ===== Application / product context chain =====
  const appContextId = id();
  ents.push(
    `#${appContextId} = APPLICATION_CONTEXT(${stepStringLiteral(
      "mechanical design",
    )});`,
  );

  const mechContextId = id();
  ents.push(
    `#${mechContextId} = MECHANICAL_CONTEXT(${stepStringLiteral(
      "PART",
    )}, #${appContextId}, ${stepStringLiteral("WORKSPACE")});`,
  );

  const prodDefContextId = id();
  ents.push(
    `#${prodDefContextId} = PRODUCT_DEFINITION_CONTEXT(${stepStringLiteral(
      "part definition",
    )}, #${appContextId}, ${stepStringLiteral("design")});`,
  );

  const productId = id();
  const partName = quoteNo
    ? `Foam block for ${quoteNo}`
    : "Foam block";
  ents.push(
    `#${productId} = PRODUCT(${stepStringLiteral(
      partName,
    )}, ${stepStringLiteral(
      "FOAM_BLOCK",
    )}, ${stepStringLiteral("")}, (#${appContextId}));`,
  );

  const pdfId = id(); // product definition formation
  ents.push(
    `#${pdfId} = PRODUCT_DEFINITION_FORMATION(${stepStringLiteral(
      "",
    )}, ${stepStringLiteral("")}, #${productId});`,
  );

  const prodDefId = id();
  ents.push(
    `#${prodDefId} = PRODUCT_DEFINITION(${stepStringLiteral(
      "",
    )}, ${stepStringLiteral("")}, #${pdfId}, #${prodDefContextId});`,
  );

  // ===== Units & representation context (mm, radian, steradian) =====
  const lengthUnitId = id();
  ents.push(
    `#${lengthUnitId} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI., .METRE.) );`,
  );

  const planeAngleUnitId = id();
  ents.push(
    `#${planeAngleUnitId} = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($, .RADIAN.) );`,
  );

  const solidAngleUnitId = id();
  ents.push(
    `#${solidAngleUnitId} = ( NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($, .STERADIAN.) );`,
  );

  const uncertaintyId = id();
  ents.push(
    `#${uncertaintyId} = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001), #${lengthUnitId}, ${stepStringLiteral(
      "distance_accuracy_value",
    )}, ${stepStringLiteral("")});`,
  );

  const contextId = id();
  ents.push(
    `#${contextId} = GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertaintyId})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnitId},#${planeAngleUnitId},#${solidAngleUnitId})) REPRESENTATION_CONTEXT(${stepStringLiteral(
      "",
    )}, ${stepStringLiteral("")});`,
  );

  // Shared X/Y directions for all placements.
  const xDirId = id();
  ents.push(
    `#${xDirId} = DIRECTION(${stepStringLiteral(
      "",
    )}, (1.,0.,0.));`,
  );

  const yDirId = id();
  ents.push(
    `#${yDirId} = DIRECTION(${stepStringLiteral(
      "",
    )}, (0.,1.,0.));`,
  );

  // ===== Base foam block =====
  const baseOriginPtId = id();
  ents.push(
    `#${baseOriginPtId} = CARTESIAN_POINT(${stepStringLiteral(
      "",
    )}, (0.,0.,0.));`,
  );

  const basePlacementId = id();
  ents.push(
    `#${basePlacementId} = AXIS2_PLACEMENT_3D(${stepStringLiteral(
      "Foam block",
    )}, #${baseOriginPtId}, #${xDirId}, #${yDirId});`,
  );

  const baseBlockId = id();
  ents.push(
    `#${baseBlockId} = BLOCK(${stepStringLiteral(
      "FOAM_BLOCK",
    )}, #${basePlacementId}, ${fmtLen(Lmm)}, ${fmtLen(
      Wmm,
    )}, ${fmtLen(Tmm)});`,
  );

  const solidIds: number[] = [baseBlockId];

  // ===== Cavity solids (visual only, NOT subtracted) =====
  for (let i = 0; i < cavities.length; i++) {
    const cav = cavities[i];

    const cavLmm = cav.lengthIn * mmPerInch;
    const cavWmm = cav.widthIn * mmPerInch;
    const cavDmm = cav.depthIn * mmPerInch;

    if (!(cavLmm > 0 && cavWmm > 0 && cavDmm > 0)) continue;

    // Normalized x,y are measured from left and top of the block.
    const leftIn = cav.x * lengthIn;
    const topIn = cav.y * widthIn;

    const leftMm = leftIn * mmPerInch;
    const topMm = topIn * mmPerInch;

    // Place the cavity solid so its top face is flush with the block top.
    //   block bottom  = 0
    //   block top     = Tmm
    //   cavity bottom = max(Tmm - cavDmm, 0)
    const cavBottomZmm = Math.max(Tmm - cavDmm, 0);

    const cavOriginPtId = id();
    ents.push(
      `#${cavOriginPtId} = CARTESIAN_POINT(${stepStringLiteral(
        "",
      )}, (${fmtLen(leftMm)},${fmtLen(topMm)},${fmtLen(
        cavBottomZmm,
      )}));`,
    );

    const cavPlacementId = id();
    ents.push(
      `#${cavPlacementId} = AXIS2_PLACEMENT_3D(${stepStringLiteral(
        `Cavity ${i + 1}`,
      )}, #${cavOriginPtId}, #${xDirId}, #${yDirId});`,
    );

    const cavBlockId = id();
    ents.push(
      `#${cavBlockId} = BLOCK(${stepStringLiteral(
        `CAVITY_${i + 1}`,
      )}, #${cavPlacementId}, ${fmtLen(cavLmm)}, ${fmtLen(
        cavWmm,
      )}, ${fmtLen(cavDmm)});`,
    );

    solidIds.push(cavBlockId);
  }

  // Shape representation + link back to product definition.
  const itemsList = solidIds.map((sid) => `#${sid}`).join(",");
  const shapeRepId = id();
  ents.push(
    `#${shapeRepId} = SHAPE_REPRESENTATION(${stepStringLiteral(
      "",
    )}, (${itemsList}), #${contextId});`,
  );

  const sdrId = id();
  ents.push(
    `#${sdrId} = SHAPE_DEFINITION_REPRESENTATION(#${prodDefId}, #${shapeRepId});`,
  );

  // ----- Assemble full STEP file -----
  const lines: string[] = [];

  lines.push("ISO-10303-21;");
  lines.push("HEADER;");
  lines.push(
    `FILE_DESCRIPTION((${stepStringLiteral(description)}),'2;1');`,
  );
  lines.push(
    `FILE_NAME(${stepStringLiteral(
      fileName,
    )},${stepStringLiteral(nowIso)},(),(),${stepStringLiteral(
      "Alex-IO",
    )},${stepStringLiteral("alex-io.com")},${stepStringLiteral(
      "STEP export v5 (block + cavity solids)",
    )});`,
  );
  // CONFIG_CONTROL_DESIGN is a common AP203-style schema used for mechanical parts.
  lines.push("FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));");
  lines.push("ENDSEC;");
  lines.push("DATA;");
  lines.push(...ents);
  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");

  return lines.join("\n");
}
