// lib/cad/step.ts
//
// STEP export helper (Path A, v7 - simple geometry + ASCII-safe strings).
//
// Geometry:
//   - One BLOCK solid for the foam block.
//   - Optional BLOCK solids for each cavity (visual only).
//   - No booleans, no CSG tree, no product hierarchy.
//
// Strings:
//   - All text is forced to plain ASCII (0x20–0x7E) and single quotes are
//     doubled per STEP rules. This avoids viewers choking on bullets, UTF-8
//     superscripts, etc.

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
  if (L <= 0 || W <= 0 || T <= 0) return null;

  return { lengthIn: L, widthIn: W, thicknessIn: T };
}

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
 * Force to plain ASCII (0x20–0x7E), then escape single quotes.
 * This avoids non-ASCII symbols (•, ·, ³, etc.) that some viewers
 * mishandle and misreport as "floating point overflow".
 */
function stepStringLiteral(input: string): string {
  // Replace any non-printable / non-ASCII with a space
  const asciiOnly = input.replace(/[^\x20-\x7E]/g, " ");
  // Escape STEP single quotes
  const safe = asciiOnly.replace(/'/g, "''");
  return `'${safe}'`;
}

/**
 * Format a numeric length for STEP.
 * Keep things boring: a small number of decimals, always with a dot.
 */
function fmtLen(n: number): string {
  if (!Number.isFinite(n)) return "0.";
  const s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  const withDec = s.includes(".") ? s : `${s}.0`;
  return withDec;
}

/* ===================== Main STEP builder ===================== */

export function buildStepFromLayout(
  layout: any,
  opts: StepBuildOptions = {},
): string | null {
  const block = getBlockDims(layout);
  if (!block) return null;

  const { lengthIn, widthIn, thicknessIn } = block;
  const quoteNo = (opts.quoteNo ?? "").trim() || null;
  const materialLegend =
    opts.materialLegend && opts.materialLegend.trim().length > 0
      ? opts.materialLegend.trim()
      : null;

  const cavities = getAllCavitiesFromLayout(layout);

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

  if (!(lengthIn > 0 && widthIn > 0 && thicknessIn > 0)) return null;

  const safeQuoteForFile =
    quoteNo?.replace(/[^A-Za-z0-9_\-]+/g, "_") || "foam_block";
  const fileName = `${safeQuoteForFile}.step`;
  const nowIso = new Date().toISOString();

  const mmPerInch = 25.4;
  const Lmm = lengthIn * mmPerInch;
  const Wmm = widthIn * mmPerInch;
  const Tmm = thicknessIn * mmPerInch;

  let nextId = 1;
  const ents: string[] = [];
  const id = () => nextId++;

  // Directions: Z is axis, X is ref
  const axisZId = id();
  ents.push(`#${axisZId} = DIRECTION('', (0.,0.,1.));`);

  const refXId = id();
  ents.push(`#${refXId} = DIRECTION('', (1.,0.,0.));`);

  // Origin
  const originId = id();
  ents.push(`#${originId} = CARTESIAN_POINT('', (0.,0.,0.));`);

  // Block placement + solid
  const blockPlacementId = id();
  ents.push(
    `#${blockPlacementId} = AXIS2_PLACEMENT_3D('Foam block', #${originId}, #${axisZId}, #${refXId});`,
  );

  const blockId = id();
  ents.push(
    `#${blockId} = BLOCK('FOAM_BLOCK', #${blockPlacementId}, ${fmtLen(
      Lmm,
    )}, ${fmtLen(Wmm)}, ${fmtLen(Tmm)});`,
  );

  const solidIds: number[] = [blockId];

  // Cavities as separate BLOCK solids (visual only)
  for (let i = 0; i < cavities.length; i++) {
    const cav = cavities[i];

    const cavLmm = cav.lengthIn * mmPerInch;
    const cavWmm = cav.widthIn * mmPerInch;
    const cavDmm = cav.depthIn * mmPerInch;
    if (!(cavLmm > 0 && cavWmm > 0 && cavDmm > 0)) continue;

    const leftIn = cav.x * lengthIn;
    const topIn = cav.y * widthIn;
    const leftMm = leftIn * mmPerInch;
    const topMm = topIn * mmPerInch;

    const cavBottomZmm = Math.max(Tmm - cavDmm, 0);

    const cavOriginId = id();
    ents.push(
      `#${cavOriginId} = CARTESIAN_POINT('', (${fmtLen(
        leftMm,
      )},${fmtLen(topMm)},${fmtLen(cavBottomZmm)}));`,
    );

    const cavPlacementId = id();
    ents.push(
      `#${cavPlacementId} = AXIS2_PLACEMENT_3D(${stepStringLiteral(
        `Cavity ${i + 1}`,
      )}, #${cavOriginId}, #${axisZId}, #${refXId});`,
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

  // Simple representation context (no units/uncertainty clutter)
  const contextId = id();
  ents.push(
    `#${contextId} = GEOMETRIC_REPRESENTATION_CONTEXT(3) REPRESENTATION_CONTEXT('', '');`,
  );

  const itemsList = solidIds.map((sid) => `#${sid}`).join(",");
  const shapeRepId = id();
  ents.push(
    `#${shapeRepId} = SHAPE_REPRESENTATION('', (${itemsList}), #${contextId});`,
  );

  // Assemble file
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
      "STEP export v7 (simple block + cavities, ASCII-safe)",
    )});`,
  );
  lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));");
  lines.push("ENDSEC;");
  lines.push("DATA;");
  lines.push(...ents);
  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");

  return lines.join("\n");
}
