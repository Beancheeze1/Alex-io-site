// lib/cad/step.ts
//
// STEP export helper (Path A, v3).
//
// v3 goal:
//   - Emit a valid STEP file that contains one or more rectangular solids:
//       * If layout.stack/layout.layers is present: one BLOCK solid per layer,
//         stacked in Z using each layer's thickness.
//       * Otherwise: single BLOCK solid using layout.block.thicknessIn.
//   - Geometry is emitted in millimeters (mm), converted from inches.
//   - Header + metadata stay stable so we can iterate later.
//
// Notes:
//   - We keep this helper self-contained and pure: no DB, no Next APIs.
//   - The calling route is responsible for passing layout + metadata.
//   - Cavities are NOT modeled in 3D here; use DXF for machining details.

import type { LayoutModel } from "@/app/quote/layout/editor/layoutTypes";

export type StepBuildOptions = {
  quoteNo?: string | null;
  materialLegend?: string | null;
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
 * Extract per-layer thickness and label from the layout.
 *
 * Priority:
 *   1) layout.stack
 *   2) layout.layers
 *   3) Fallback: single layer with overall block thickness
 */
function getLayerSpecs(
  layout: any,
  fallbackThicknessIn: number,
): { label: string; thicknessIn: number }[] {
  const out: { label: string; thicknessIn: number }[] = [];

  const rawLayers = Array.isArray((layout as any)?.stack)
    ? (layout as any).stack
    : Array.isArray((layout as any)?.layers)
    ? (layout as any).layers
    : null;

  if (Array.isArray(rawLayers) && rawLayers.length > 0) {
    let idx = 0;
    for (const rawLayer of rawLayers) {
      if (!rawLayer) continue;
      idx += 1;

      const tRaw =
        (rawLayer as any).thicknessIn ??
        (rawLayer as any).thickness_in ??
        (rawLayer as any).thickness;
      const t = Number(tRaw);
      if (!Number.isFinite(t) || t <= 0) continue;

      const rawLabel =
        (rawLayer as any).label ??
        (rawLayer as any).name ??
        (rawLayer as any).title ??
        null;

      const label =
        typeof rawLabel === "string" && rawLabel.trim().length > 0
          ? rawLabel.trim()
          : `Layer ${idx}`;

      out.push({ label, thicknessIn: t });
    }
  }

  // Fallback: single layer matching the block thickness
  if (out.length === 0 && fallbackThicknessIn > 0) {
    out.push({
      label: "Foam block",
      thicknessIn: fallbackThicknessIn,
    });
  }

  return out;
}

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

/**
 * Build a **valid STEP file** for a foam layout.
 *
 * Geometry:
 *   - One BLOCK solid per foam layer, stacked along +Z.
 *   - Dimensions are in mm:
 *       L_mm = L_in * 25.4
 *       W_mm = W_in * 25.4
 *       T_mm = T_in * 25.4 (per layer)
 *
 * Metadata:
 *   - FILE_DESCRIPTION summarizing dims (in inches), quote, material.
 *   - FILE_NAME derived from quoteNo where possible.
 *   - FILE_SCHEMA('CONFIG_CONTROL_DESIGN').
 *
 * This is conservative but widely accepted by CAD tools.
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

  // Determine layer structure (multi-layer or single-block fallback).
  const layerSpecs = getLayerSpecs(layout, thicknessIn);
  if (!layerSpecs.length) {
    return null;
  }

  // Build a human-readable description for FILE_DESCRIPTION.
  const descParts: string[] = [];
  descParts.push(
    `Foam block ${lengthIn} x ${widthIn} x ${thicknessIn} in`,
  );
  if (layerSpecs.length > 1) {
    const totalT = layerSpecs.reduce(
      (sum, l) => sum + l.thicknessIn,
      0,
    );
    descParts.push(
      `Multi-layer: ${layerSpecs.length} layer(s), total thickness ${totalT} in`,
    );
  }
  if (quoteNo) {
    descParts.push(`Quote ${quoteNo}`);
  }
  if (materialLegend) {
    descParts.push(materialLegend);
  }
  const description = descParts.join(" | ");

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

  // Shared X/Y directions for all layers.
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

  // ===== Layer solids (BLOCK per layer, stacked in Z) =====
  const layerSolidIds: number[] = [];
  let zOffsetMm = 0;

  layerSpecs.forEach((layer, idx) => {
    const Tmm = layer.thicknessIn * mmPerInch;
    if (!(Tmm > 0)) return;

    // Origin for this layer is at (0,0,zOffsetMm).
    const originPtId = id();
    ents.push(
      `#${originPtId} = CARTESIAN_POINT(${stepStringLiteral(
        "",
      )}, (0.,0.,${fmtLen(zOffsetMm)}));`,
    );

    const placementId = id();
    ents.push(
      `#${placementId} = AXIS2_PLACEMENT_3D(${stepStringLiteral(
        layer.label,
      )}, #${originPtId}, #${xDirId}, #${yDirId});`,
    );

    const blockId = id();
    ents.push(
      `#${blockId} = BLOCK(${stepStringLiteral(
        layer.label,
      )}, #${placementId}, ${fmtLen(Lmm)}, ${fmtLen(
        Wmm,
      )}, ${fmtLen(Tmm)});`,
    );

    layerSolidIds.push(blockId);
    zOffsetMm += Tmm;
  });

  if (!layerSolidIds.length) {
    return null;
  }

  // Shape representation + link back to product definition.
  const itemsList = layerSolidIds.map((sid) => `#${sid}`).join(",");
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
      "STEP export v3 (multi-layer BLOCK solids)",
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
