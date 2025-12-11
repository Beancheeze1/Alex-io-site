// lib/cad/step.ts
//
// STEP exporter for foam layouts.
// - Z-up coordinate system
// - One solid per foam layer
// - Cavities cut out with BOOLEAN_RESULT(.DIFFERENCE.)
// - Units: millimeters (standard STEP practice)

///////////////////////////////////////////////////////////////
// ID allocator (STEP requires numeric references)
///////////////////////////////////////////////////////////////

class StepIdAllocator {
  private nextId = 1;
  alloc() {
    return this.nextId++;
  }
}

///////////////////////////////////////////////////////////////
// ASCII-safe STEP string wrapper
// - Removes all non-ASCII characters (√, ·, ³, etc.)
// - Escapes single quotes by doubling them
///////////////////////////////////////////////////////////////

function stepString(str: string): string {
  const ascii = str.replace(/[^\x20-\x7E]/g, " ");
  const escaped = ascii.replace(/'/g, "''");
  return `'${escaped}'`;
}

///////////////////////////////////////////////////////////////
// Numeric formatter for lengths (mm)
///////////////////////////////////////////////////////////////

function mm(n: number): string {
  if (!Number.isFinite(n)) return "0.";
  const s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s.includes(".") ? s : s + ".0";
}

///////////////////////////////////////////////////////////////
// Geometric convenience: point creator
///////////////////////////////////////////////////////////////

type Pt = { x: number; y: number; z: number };

function pt(x: number, y: number, z: number): Pt {
  return { x, y, z };
}

///////////////////////////////////////////////////////////////
// Convert inches → millimeters
///////////////////////////////////////////////////////////////

const INCH_TO_MM = 25.4;

function inToMm(inches: number): number {
  return inches * INCH_TO_MM;
}

///////////////////////////////////////////////////////////////
// Layout data structures (types only)
///////////////////////////////////////////////////////////////

export type FoamLayer = {
  thicknessIn: number;
  label?: string | null;
  cavities?:
    | Array<{
        lengthIn: number;
        widthIn: number;
        depthIn: number;
        x: number; // normalized 0..1
        y: number; // normalized 0..1
      }>
    | null;
};

export type LayoutForStep = {
  block: {
    lengthIn: number;
    widthIn: number;
    thicknessIn: number; // total stack height
  };
  stack: FoamLayer[];
  // legacy single-layer cavities (L1 rule: attach to top layer)
  cavities?: FoamLayer["cavities"];
};

///////////////////////////////////////////////////////////////
// Utility: ensure positive, finite numbers
///////////////////////////////////////////////////////////////

function safe(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

///////////////////////////////////////////////////////////////
// STEP entity representation
///////////////////////////////////////////////////////////////

type StepEntity = { id: number; text: string };

class StepBuilder {
  private ents: StepEntity[] = [];
  private ids: StepIdAllocator;

  constructor(ids?: StepIdAllocator) {
    this.ids = ids ?? new StepIdAllocator();
  }

  add(text: string): number {
    const id = this.ids.alloc();
    this.ents.push({ id, text });
    return id;
  }

  emitAll(): string[] {
    return this.ents.map((e) => `#${e.id} = ${e.text};`);
  }
}

///////////////////////////////////////////////////////////////
// STEP topology helpers
///////////////////////////////////////////////////////////////

// 1) Cartesian point
function makePoint(sb: StepBuilder, p: Pt): number {
  return sb.add(
    `CARTESIAN_POINT('', (${mm(p.x)},${mm(p.y)},${mm(p.z)}))`
  );
}

// 2) Direction
function makeDirection(
  sb: StepBuilder,
  dx: number,
  dy: number,
  dz: number
): number {
  return sb.add(`DIRECTION('', (${dx},${dy},${dz}))`);
}

// 3) Vector (unused but kept for future use)
function makeVector(
  sb: StepBuilder,
  dirId: number,
  mag: number
): number {
  return sb.add(`VECTOR('', #${dirId}, ${mm(mag)})`);
}

// 4) EdgeCurve (straight line edge)
function makeEdge(
  sb: StepBuilder,
  startPtId: number,
  endPtId: number,
  dir: { dx: number; dy: number; dz: number }
): number {
  const baseDirId = makeDirection(sb, dir.dx, dir.dy, dir.dz);
  const lineId = sb.add(`LINE('', #${startPtId}, #${baseDirId})`);
  return sb.add(
    `EDGE_CURVE('', #${startPtId}, #${endPtId}, #${lineId}, .T.)`
  );
}

// 5) Oriented edge
function makeOrientedEdge(
  sb: StepBuilder,
  edgeId: number,
  sense: boolean
): number {
  return sb.add(
    `ORIENTED_EDGE('', *, *, #${edgeId}, ${sense ? ".T." : ".F."})`
  );
}

// 6) EDGE_LOOP
function makeLoop(sb: StepBuilder, orientedEdgeIds: number[]): number {
  const list = orientedEdgeIds.map((id) => `#${id}`).join(",");
  return sb.add(`EDGE_LOOP('', (${list}))`);
}

// 7) Plane for a face
function makePlane(
  sb: StepBuilder,
  originId: number,
  normalDirId: number,
  refDirId: number
): number {
  const axId = sb.add(
    `AXIS2_PLACEMENT_3D('', #${originId}, #${normalDirId}, #${refDirId})`
  );
  return sb.add(`PLANE('', #${axId})`);
}

// 8) AdvancedFace from loop + plane
function makeFace(
  sb: StepBuilder,
  loopId: number,
  planeId: number,
  sameSense = true
): number {
  return sb.add(
    `ADVANCED_FACE('', (#${loopId}), #${planeId}, ${
      sameSense ? ".T." : ".F."
    })`
  );
}

// 9) ClosedShell
function makeClosedShell(sb: StepBuilder, faceIds: number[]): number {
  const list = faceIds.map((id) => `#${id}`).join(",");
  return sb.add(`CLOSED_SHELL('', (${list}))`);
}

// 10) ManifoldSolidBrep
function makeSolid(sb: StepBuilder, shellId: number): number {
  return sb.add(`MANIFOLD_SOLID_BREP('', #${shellId})`);
}

///////////////////////////////////////////////////////////////
// Rectangular solid builder (box with 6 faces)
///////////////////////////////////////////////////////////////

function makeRectSolid(
  sb: StepBuilder,
  corner: Pt, // lower-left-bottom corner
  L: number, // length  (X)
  W: number, // width   (Y)
  H: number // height  (Z)
): number {
  // Corner points
  const p000 = makePoint(sb, pt(corner.x, corner.y, corner.z));
  const p100 = makePoint(sb, pt(corner.x + L, corner.y, corner.z));
  const p110 = makePoint(sb, pt(corner.x + L, corner.y + W, corner.z));
  const p010 = makePoint(sb, pt(corner.x, corner.y + W, corner.z));

  const p001 = makePoint(sb, pt(corner.x, corner.y, corner.z + H));
  const p101 = makePoint(sb, pt(corner.x + L, corner.y, corner.z + H));
  const p111 = makePoint(sb, pt(corner.x + L, corner.y + W, corner.z + H));
  const p011 = makePoint(sb, pt(corner.x, corner.y + W, corner.z + H));

  const up = makeDirection(sb, 0, 0, 1);
  const down = makeDirection(sb, 0, 0, -1);
  const dx = makeDirection(sb, 1, 0, 0);
  const nx = makeDirection(sb, -1, 0, 0);
  const dy = makeDirection(sb, 0, 1, 0);
  const ny = makeDirection(sb, 0, -1, 0);

  const refX = dx;
  const refY = dy;

  // FRONT (Z = corner.z)
  const eF1 = makeEdge(sb, p000, p100, { dx: 1, dy: 0, dz: 0 });
  const eF2 = makeEdge(sb, p100, p110, { dx: 0, dy: 1, dz: 0 });
  const eF3 = makeEdge(sb, p110, p010, { dx: -1, dy: 0, dz: 0 });
  const eF4 = makeEdge(sb, p010, p000, { dx: 0, dy: -1, dz: 0 });

  const oF1 = makeOrientedEdge(sb, eF1, true);
  const oF2 = makeOrientedEdge(sb, eF2, true);
  const oF3 = makeOrientedEdge(sb, eF3, true);
  const oF4 = makeOrientedEdge(sb, eF4, true);

  const loopF = makeLoop(sb, [oF1, oF2, oF3, oF4]);
  const planeF = makePlane(sb, p000, down, refX);
  const faceF = makeFace(sb, loopF, planeF);

  // BACK (Z = corner.z + H)
  const eB1 = makeEdge(sb, p001, p101, { dx: 1, dy: 0, dz: 0 });
  const eB2 = makeEdge(sb, p101, p111, { dx: 0, dy: 1, dz: 0 });
  const eB3 = makeEdge(sb, p111, p011, { dx: -1, dy: 0, dz: 0 });
  const eB4 = makeEdge(sb, p011, p001, { dx: 0, dy: -1, dz: 0 });

  const oB1 = makeOrientedEdge(sb, eB1, true);
  const oB2 = makeOrientedEdge(sb, eB2, true);
  const oB3 = makeOrientedEdge(sb, eB3, true);
  const oB4 = makeOrientedEdge(sb, eB4, true);

  const loopB = makeLoop(sb, [oB1, oB2, oB3, oB4]);
  const planeB = makePlane(sb, p001, up, refX);
  const faceB = makeFace(sb, loopB, planeB);

  // LEFT (X = corner.x)
  const eL1 = makeEdge(sb, p000, p010, { dx: 0, dy: 1, dz: 0 });
  const eL2 = makeEdge(sb, p010, p011, { dx: 0, dy: 0, dz: 1 });
  const eL3 = makeEdge(sb, p011, p001, { dx: 0, dy: -1, dz: 0 });
  const eL4 = makeEdge(sb, p001, p000, { dx: 0, dy: 0, dz: -1 });

  const oL1 = makeOrientedEdge(sb, eL1, true);
  const oL2 = makeOrientedEdge(sb, eL2, true);
  const oL3 = makeOrientedEdge(sb, eL3, true);
  const oL4 = makeOrientedEdge(sb, eL4, true);

  const loopL = makeLoop(sb, [oL1, oL2, oL3, oL4]);
  const planeL = makePlane(sb, p000, nx, refY);
  const faceL = makeFace(sb, loopL, planeL);

  // RIGHT (X = corner.x + L)
  const eR1 = makeEdge(sb, p100, p110, { dx: 0, dy: 1, dz: 0 });
  const eR2 = makeEdge(sb, p110, p111, { dx: 0, dy: 0, dz: 1 });
  const eR3 = makeEdge(sb, p111, p101, { dx: 0, dy: -1, dz: 0 });
  const eR4 = makeEdge(sb, p101, p100, { dx: 0, dy: 0, dz: -1 });

  const oR1 = makeOrientedEdge(sb, eR1, true);
  const oR2 = makeOrientedEdge(sb, eR2, true);
  const oR3 = makeOrientedEdge(sb, eR3, true);
  const oR4 = makeOrientedEdge(sb, eR4, true);

  const loopR = makeLoop(sb, [oR1, oR2, oR3, oR4]);
  const planeR = makePlane(sb, p100, dx, refY);
  const faceR = makeFace(sb, loopR, planeR);

  // BOTTOM (Y = corner.y)
  const eD1 = makeEdge(sb, p000, p100, { dx: 1, dy: 0, dz: 0 });
  const eD2 = makeEdge(sb, p100, p101, { dx: 0, dy: 0, dz: 1 });
  const eD3 = makeEdge(sb, p101, p001, { dx: -1, dy: 0, dz: 0 });
  const eD4 = makeEdge(sb, p001, p000, { dx: 0, dy: 0, dz: -1 });

  const oD1 = makeOrientedEdge(sb, eD1, true);
  const oD2 = makeOrientedEdge(sb, eD2, true);
  const oD3 = makeOrientedEdge(sb, eD3, true);
  const oD4 = makeOrientedEdge(sb, eD4, true);

  const loopD = makeLoop(sb, [oD1, oD2, oD3, oD4]);
  const planeD = makePlane(sb, p000, ny, refX);
  const faceD = makeFace(sb, loopD, planeD);

  // TOP (Y = corner.y + W)
  const eT1 = makeEdge(sb, p010, p110, { dx: 1, dy: 0, dz: 0 });
  const eT2 = makeEdge(sb, p110, p111, { dx: 0, dy: 0, dz: 1 });
  const eT3 = makeEdge(sb, p111, p011, { dx: -1, dy: 0, dz: 0 });
  const eT4 = makeEdge(sb, p011, p010, { dx: 0, dy: 0, dz: -1 });

  const oT1 = makeOrientedEdge(sb, eT1, true);
  const oT2 = makeOrientedEdge(sb, eT2, true);
  const oT3 = makeOrientedEdge(sb, eT3, true);
  const oT4 = makeOrientedEdge(sb, eT4, true);

  const loopT = makeLoop(sb, [oT1, oT2, oT3, oT4]);
  const planeT = makePlane(sb, p010, dy, refX);
  const faceT = makeFace(sb, loopT, planeT);

  const shellId = makeClosedShell(sb, [
    faceF,
    faceB,
    faceL,
    faceR,
    faceD,
    faceT,
  ]);
  return makeSolid(sb, shellId);
}

///////////////////////////////////////////////////////////////
// Boolean subtraction
///////////////////////////////////////////////////////////////

function booleanSubtract(
  sb: StepBuilder,
  leftSolidId: number,
  rightSolidId: number
): number {
  return sb.add(
    `BOOLEAN_RESULT(.DIFFERENCE., #${leftSolidId}, #${rightSolidId})`
  );
}

///////////////////////////////////////////////////////////////
// Cavity + layer helpers
///////////////////////////////////////////////////////////////

type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number;
  y: number;
};

function makeCavitySolid(
  sb: StepBuilder,
  cav: CavityDef,
  blockLengthIn: number,
  blockWidthIn: number,
  layerBottomZmm: number,
  layerThicknessIn: number
): number {
  const Lmm = inToMm(safe(cav.lengthIn));
  const Wmm = inToMm(safe(cav.widthIn));

  // NEW: clamp cavity depth to the actual layer thickness (in mm)
  const totalLayerThicknessMm = inToMm(layerThicknessIn);
  const rawDepthMm = inToMm(safe(cav.depthIn));
  const Dmm = Math.min(rawDepthMm, totalLayerThicknessMm);

  // Cavity top at top of layer, cut downward
  const cavityTopZ = layerBottomZmm + totalLayerThicknessMm;
  const cavityBottomZ = cavityTopZ - Dmm;

  const leftMm = inToMm(blockLengthIn * cav.x);
  const topMm = inToMm(blockWidthIn * cav.y);

  const corner = pt(leftMm, topMm, cavityBottomZ);

  return makeRectSolid(sb, corner, Lmm, Wmm, Dmm);
}

function makeLayerBlockSolid(
  sb: StepBuilder,
  blockLengthIn: number,
  blockWidthIn: number,
  layerThicknessIn: number,
  layerBottomZmm: number
): number {
  const Lmm = inToMm(blockLengthIn);
  const Wmm = inToMm(blockWidthIn);
  const Hmm = inToMm(layerThicknessIn);
  const corner = pt(0, 0, layerBottomZmm);
  return makeRectSolid(sb, corner, Lmm, Wmm, Hmm);
}

function applyCavitiesToLayer(
  sb: StepBuilder,
  layerBlockSolidId: number,
  cavitySolidIds: number[]
): number {
  let current = layerBlockSolidId;
  for (const cavId of cavitySolidIds) {
    current = booleanSubtract(sb, current, cavId);
  }
  return current;
}

///////////////////////////////////////////////////////////////
// Public: build full STEP text from a layout
///////////////////////////////////////////////////////////////

export function buildStepFromLayoutFull(
  layout: any,
  quoteNo: string,
  materialLegend: string | null
): string | null {
  if (!layout?.block) return null;

  const blockL = safe(layout.block.lengthIn);
  const blockW = safe(layout.block.widthIn);

  const layers: any[] = Array.isArray(layout.stack)
    ? layout.stack
    : [
        {
          id: "single",
          label: "Foam layer",
          thicknessIn: safe(layout.block.thicknessIn),
          cavities: layout.cavities || [],
        },
      ];

  if (!layers.length || blockL <= 0 || blockW <= 0) return null;

  const sb = new StepBuilder();

  // Orientation (Z-up)
  const dirZ = sb.add(`DIRECTION('', (0.,0.,1.))`);
  const dirX = sb.add(`DIRECTION('', (1.,0.,0.))`);
  const origin = sb.add(`CARTESIAN_POINT('', (0.,0.,0.))`);
  const _baseAX = sb.add(
    `AXIS2_PLACEMENT_3D('Base', #${origin}, #${dirZ}, #${dirX})`
  );

  // Track Z stacking
  let currentBottomZmm = 0;
  const finalLayerSolidIds: number[] = [];

  for (const layer of layers) {
    const thicknessIn = safe((layer as any).thicknessIn);
    if (thicknessIn <= 0) continue;

    const layerBottomZ = currentBottomZmm;

    // 1) Base layer block
    const layerBlockSolidId = makeLayerBlockSolid(
      sb,
      blockL,
      blockW,
      thicknessIn,
      layerBottomZ
    );

    // 2) Cavity solids
    const cavityDefs: CavityDef[] = [];
    if (Array.isArray((layer as any).cavities)) {
      for (const rawCav of (layer as any).cavities as any[]) {
        if (!rawCav) continue;
        const Lc = safe(rawCav.lengthIn);
        const Wc = safe(rawCav.widthIn);
        const Dc = safe(rawCav.depthIn);
        const nx = Number(rawCav.x);
        const ny = Number(rawCav.y);
        if (
          Lc > 0 &&
          Wc > 0 &&
          Dc > 0 &&
          nx >= 0 &&
          nx <= 1 &&
          ny >= 0 &&
          ny <= 1
        ) {
          cavityDefs.push({
            lengthIn: Lc,
            widthIn: Wc,
            depthIn: Dc,
            x: nx,
            y: ny,
          });
        }
      }
    }

    const cavitySolidIds: number[] = [];
    for (const cav of cavityDefs) {
      const cavSolidId = makeCavitySolid(
        sb,
        cav,
        blockL,
        blockW,
        layerBottomZ,
        thicknessIn
      );
      cavitySolidIds.push(cavSolidId);
    }

    // 3) Apply booleans
    const finalLayerSolid = applyCavitiesToLayer(
      sb,
      layerBlockSolidId,
      cavitySolidIds
    );
    finalLayerSolidIds.push(finalLayerSolid);

    currentBottomZmm += inToMm(thicknessIn);
  }

  if (!finalLayerSolidIds.length) return null;

  // ===================== Representation context + shape rep =====================

  const repCtx = sb.add(
    `GEOMETRIC_REPRESENTATION_CONTEXT(3) REPRESENTATION_CONTEXT('', '')`
  );

  const solidsList = finalLayerSolidIds.map((id) => `#${id}`).join(",");

  // Advanced BREP shape representation so CAD tools treat this as real 3D solids
  const shapeRepId = sb.add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('Foam Layout', (${solidsList}), #${repCtx})`
  );

  // Minimal AP203-style product / shape wiring so that tools like
  // SolidWorks / Bambu / ABViewer see an actual part with geometry.
  const appCtxId = sb.add(
    `APPLICATION_CONTEXT('mechanical design')`
  );
  const prodCtxId = sb.add(
    `PRODUCT_CONTEXT('', #${appCtxId}, 'mechanical')`
  );

  const productId = sb.add(
    `PRODUCT(${stepString(
      `Foam layout ${quoteNo}`
    )}, ${stepString("Foam layout")}, '', (#${prodCtxId}))`
  );

  const pdfsId = sb.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('', ${stepString(
      "Foam layout"
    )}, #${productId}, .NOT_KNOWN.)`
  );

  const prodDefId = sb.add(
    `PRODUCT_DEFINITION('', '', #${pdfsId}, #${prodCtxId})`
  );

  const prodDefShapeId = sb.add(
    `PRODUCT_DEFINITION_SHAPE('', '', #${prodDefId})`
  );

  // Link the product definition shape to our BREP representation
  const _shapeDefRepId = sb.add(
    `SHAPE_DEFINITION_REPRESENTATION(#${prodDefShapeId}, #${shapeRepId})`
  );

  // ===================== Wrap everything in ISO-10303-21 =====================

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION((${stepString(
      `Foam layout | Quote ${quoteNo}${
        materialLegend ? ` | ${materialLegend}` : ""
      }`
    )}),'2;1');`,
    `FILE_NAME(${stepString(
      `${quoteNo}.step`
    )},${stepString(
      new Date().toISOString()
    )},(),(),'Alex-IO','alex-io.com','Foam STEP export');`,
    // Use a more standard schema that CAD tools expect for mechanical parts
    "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
    "ENDSEC;",
    "DATA;",
  ].join("\n");

  const dataLines = sb.emitAll();
  const data = dataLines.join("\n");

  const footer = ["ENDSEC;", "END-ISO-10303-21;"].join("\n");

  return `${header}\n${data}\n${footer}`;
}
