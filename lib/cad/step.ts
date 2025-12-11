// lib/cad/step.ts
// Core utilities, ASCII-safe STEP strings, ID allocator, numeric helpers.

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
  cavities?: Array<{
    lengthIn: number;
    widthIn: number;
    depthIn: number;
    x: number; // normalized 0..1
    y: number; // normalized 0..1
  }> | null;
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

function safe(n: any): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

///////////////////////////////////////////////////////////////
// END CHUNK 1
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
// CHUNK 2/4 — Geometry Primitives + Topological Building Blocks
///////////////////////////////////////////////////////////////

// A STEP entity in memory before string emission
type StepEntity = { id: number; text: string };

///////////////////////////////////////////////////////////////
// Local builder stores all STEP entities in memory
///////////////////////////////////////////////////////////////

class StepBuilder {
  ents: StepEntity[] = [];
  ids: StepIdAllocator;

  constructor() {
    this.ids = new StepIdAllocator();
  }

  add(text: string): number {
    const id = this.ids.alloc();
    this.ents.push({ id, text });
    return id;
  }

  // Return a single STEP DATA section body
  build(): string {
    return this.ents.map((e) => `#${e.id} = ${e.text};`).join("\n");
  }

  // (kept for completeness; not used by buildStepFromLayoutFull)
  emitAll(): string[] {
    return this.ents.map((e) => `#${e.id} = ${e.text};`);
  }
}

///////////////////////////////////////////////////////////////
// STEP topology helpers
///////////////////////////////////////////////////////////////

//
// 1) Create a Cartesian point (#x = CARTESIAN_POINT('',(x,y,z));)
//
function makePoint(sb: StepBuilder, p: Pt): number {
  return sb.add(
    `CARTESIAN_POINT('', (${mm(p.x)},${mm(p.y)},${mm(p.z)}))`
  );
}

//
// 2) Create a Direction (#x = DIRECTION('', (dx,dy,dz));)
//
function makeDirection(
  sb: StepBuilder,
  dx: number,
  dy: number,
  dz: number,
): number {
  return sb.add(`DIRECTION('', (${dx},${dy},${dz}))`);
}

//
// 3) Make a Vector
//
function makeVector(sb: StepBuilder, dirId: number, mag: number): number {
  return sb.add(`VECTOR('', #${dirId}, ${mm(mag)})`);
}

//
// 4) Create an EdgeCurve (straight line edge)
//
function makeEdge(
  sb: StepBuilder,
  startPtId: number,
  endPtId: number,
  dir: { dx: number; dy: number; dz: number },
): number {
  // underlying line: LINE('', base_point, direction)
  const baseDirId = makeDirection(sb, dir.dx, dir.dy, dir.dz);
  const lineId = sb.add(`LINE('', #${startPtId}, #${baseDirId})`);

  // edge curve
  return sb.add(
    `EDGE_CURVE('', #${startPtId}, #${endPtId}, #${lineId}, .T.)`,
  );
}

//
// 5) Oriented edge (refers to an existing edge, provides direction)
//
function makeOrientedEdge(
  sb: StepBuilder,
  edgeId: number,
  sense: boolean,
): number {
  return sb.add(
    `ORIENTED_EDGE('', *, *, #${edgeId}, ${sense ? ".T." : ".F."})`,
  );
}

//
// 6) Assemble four oriented edges into an EDGE_LOOP
//
function makeLoop(sb: StepBuilder, orientedEdgeIds: number[]): number {
  const list = orientedEdgeIds.map((id) => `#${id}`).join(",");
  return sb.add(`EDGE_LOOP('', (${list}))`);
}

//
// 7) Create a Plane for a face
//
function makePlane(
  sb: StepBuilder,
  originId: number,
  normalDirId: number,
  refDirId: number,
): number {
  // Placement for the plane
  const axId = sb.add(
    `AXIS2_PLACEMENT_3D('', #${originId}, #${normalDirId}, #${refDirId})`,
  );

  // The PLANE entity
  return sb.add(`PLANE('', #${axId})`);
}

//
// 8) Create an AdvancedFace from a loop + plane
//
function makeFace(
  sb: StepBuilder,
  loopId: number,
  planeId: number,
  sameSense = true,
): number {
  return sb.add(
    `ADVANCED_FACE('', (#${loopId}), #${planeId}, ${
      sameSense ? ".T." : ".F."
    })`,
  );
}

//
// 9) Combine faces into a ClosedShell
//
function makeClosedShell(sb: StepBuilder, faceIds: number[]): number {
  const list = faceIds.map((id) => `#${id}`).join(",");
  return sb.add(`CLOSED_SHELL('', (${list}))`);
}

//
// 10) Make a ManifoldSolidBrep from a shell
//
function makeSolid(sb: StepBuilder, shellId: number): number {
  return sb.add(`MANIFOLD_SOLID_BREP('', #${shellId})`);
}

///////////////////////////////////////////////////////////////
// Rectangle Solid BREP Generator
///////////////////////////////////////////////////////////////

function makeRectSolid(
  sb: StepBuilder,
  corner: Pt, // lower-left-bottom corner
  L: number, // length  (X)
  W: number, // width   (Y)
  H: number, // height  (Z)
): number {
  // Corner points in SPACE
  const p000 = makePoint(
    sb,
    pt(corner.x, corner.y, corner.z),
  );
  const p100 = makePoint(
    sb,
    pt(corner.x + L, corner.y, corner.z),
  );
  const p110 = makePoint(
    sb,
    pt(corner.x + L, corner.y + W, corner.z),
  );
  const p010 = makePoint(
    sb,
    pt(corner.x, corner.y + W, corner.z),
  );

  const p001 = makePoint(
    sb,
    pt(corner.x, corner.y, corner.z + H),
  );
  const p101 = makePoint(
    sb,
    pt(corner.x + L, corner.y, corner.z + H),
  );
  const p111 = makePoint(
    sb,
    pt(corner.x + L, corner.y + W, corner.z + H),
  );
  const p011 = makePoint(
    sb,
    pt(corner.x, corner.y + W, corner.z + H),
  );

  // Directions for planar faces
  const up = makeDirection(sb, 0, 0, 1);
  const down = makeDirection(sb, 0, 0, -1);
  const dx = makeDirection(sb, 1, 0, 0);
  const nx = makeDirection(sb, -1, 0, 0);
  const dy = makeDirection(sb, 0, 1, 0);
  const ny = makeDirection(sb, 0, -1, 0);

  // We need reference directions for plane definitions:
  const refX = dx;
  const refY = dy;

  // FRONT FACE (Z = corner.z)
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

  // BACK FACE (Z = corner.z + H)
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

  // LEFT FACE (X = corner.x)
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

  // RIGHT FACE (X = corner.x + L)
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

  // BOTTOM FACE (Y = corner.y)
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

  // TOP FACE (Y = corner.y + W)
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

  // Combine faces into a solid
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
// END CHUNK 2
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
// CHUNK 3/4 — Boolean Subtraction + Layer + Cavity Solids
///////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////
// BOOLEAN DIFFERENCE
///////////////////////////////////////////////////////////////

function booleanSubtract(
  sb: StepBuilder,
  leftSolidId: number,
  rightSolidId: number,
): number {
  return sb.add(
    `BOOLEAN_RESULT(.DIFFERENCE., #${leftSolidId}, #${rightSolidId})`,
  );
}

///////////////////////////////////////////////////////////////
// Cavity solid (rectangular block)
///////////////////////////////////////////////////////////////

type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number; // normalized 0..1 from left
  y: number; // normalized 0..1 from top
};

function makeCavitySolid(
  sb: StepBuilder,
  cav: CavityDef,
  blockLengthIn: number,
  blockWidthIn: number,
  layerTopZmm: number,
  layerThicknessIn: number,
): number {
  const Lmm = inToMm(safe(cav.lengthIn));
  const Wmm = inToMm(safe(cav.widthIn));
  const Dmm = inToMm(safe(cav.depthIn));

  const totalLayerThicknessMm = inToMm(layerThicknessIn);

  // Cavity top is at the TOP of the layer
  const cavityTopZ = layerTopZmm + totalLayerThicknessMm;
  const cavityBottomZ = cavityTopZ - Dmm; // cuts downward (B1 rule)

  // Horizontal placement based on normalized cavity.x/y
  const leftMm = inToMm(blockLengthIn * cav.x);
  const topMm = inToMm(blockWidthIn * cav.y);

  // Cavity corner is lower-left-bottom:
  const corner = pt(leftMm, topMm, cavityBottomZ);

  return makeRectSolid(sb, corner, Lmm, Wmm, Dmm);
}

///////////////////////////////////////////////////////////////
// Foam layer BREP block
///////////////////////////////////////////////////////////////

function makeLayerBlockSolid(
  sb: StepBuilder,
  blockLengthIn: number,
  blockWidthIn: number,
  layerThicknessIn: number,
  layerBottomZmm: number,
): number {
  const Lmm = inToMm(blockLengthIn);
  const Wmm = inToMm(blockWidthIn);
  const Hmm = inToMm(layerThicknessIn);

  const corner = pt(0, 0, layerBottomZmm);

  return makeRectSolid(sb, corner, Lmm, Wmm, Hmm);
}

///////////////////////////////////////////////////////////////
// Subtract all cavities for a layer
///////////////////////////////////////////////////////////////

function applyCavitiesToLayer(
  sb: StepBuilder,
  layerBlockSolidId: number,
  cavitySolidIds: number[],
): number {
  let current = layerBlockSolidId;

  for (const cav of cavitySolidIds) {
    current = booleanSubtract(sb, current, cav);
  }

  return current;
}

///////////////////////////////////////////////////////////////
// END CHUNK 3
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
// CHUNK 4/4 — Full STEP File Assembly
///////////////////////////////////////////////////////////////

/**
 * Build full STEP text for:
 *  - Multi-layer foam stack
 *  - Each layer as a separate solid
 *  - Cavities subtracted using BOOLEAN_RESULT
 *  - Z-up coordinate system
 */
export function buildStepFromLayoutFull(
  layout: any,
  quoteNo: string,
  materialLegend: string | null,
): string | null {
  if (!layout?.block) return null;

  const blockL = safe(layout.block.lengthIn);
  const blockW = safe(layout.block.widthIn);

  const layers = Array.isArray(layout.stack)
    ? layout.stack
    : [
        {
          id: "single",
          label: "Foam layer",
          thicknessIn: safe(layout.block.thicknessIn),
          cavities: layout.cavities || [],
        },
      ];

  if (!layers.length) return null;

  const sb = new StepBuilder();

  ///////////////////////////////////////////////////////////////
  // Establish orientation: Z-up = (0,0,1)
  ///////////////////////////////////////////////////////////////
  const dirZ = sb.add(`DIRECTION('', (0.,0.,1.))`);
  const dirX = sb.add(`DIRECTION('', (1.,0.,0.))`);
  const origin = sb.add(`CARTESIAN_POINT('', (0.,0.,0.))`);
  const baseAX = sb.add(
    `AXIS2_PLACEMENT_3D('Base', #${origin}, #${dirZ}, #${dirX})`,
  );

  ///////////////////////////////////////////////////////////////
  // Compute Z offsets for each layer
  ///////////////////////////////////////////////////////////////
  const layerThicknesses: number[] = layers.map(
    (l: any) => safe(l.thicknessIn),
  );
  const totalThickness = layerThicknesses.reduce(
    (a: number, b: number) => a + b,
    0,
  );

  let currentBottomZmm = 0; // bottom pad starts at Z=0

  ///////////////////////////////////////////////////////////////
  // Collect final solids
  ///////////////////////////////////////////////////////////////
  const finalLayerSolidIds: number[] = [];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const thicknessIn = safe(layer.thicknessIn);
    const layerBottomZ = currentBottomZmm;
    const layerTopZ = layerBottomZ + inToMm(thicknessIn);

    ///////////////////////////////////////////////////////////////
    // 1) Build layer block
    ///////////////////////////////////////////////////////////////
    const layerBlockSolidId = makeLayerBlockSolid(
      sb,
      blockL,
      blockW,
      thicknessIn,
      layerBottomZ,
    );

    ///////////////////////////////////////////////////////////////
    // 2) Build cavity solids for THIS layer
    ///////////////////////////////////////////////////////////////
    const cavityDefs: CavityDef[] = [];

    if (Array.isArray(layer.cavities)) {
      for (const cav of layer.cavities) {
        const L = safe(cav.lengthIn);
        const W = safe(cav.widthIn);
        const D = safe(cav.depthIn);
        const nx = safe(cav.x);
        const ny = safe(cav.y);

        if (L > 0 && W > 0 && D > 0) {
          cavityDefs.push({
            lengthIn: L,
            widthIn: W,
            depthIn: D,
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
        thicknessIn,
      );
      cavitySolidIds.push(cavSolidId);
    }

    ///////////////////////////////////////////////////////////////
    // 3) Apply boolean subtraction chain
    ///////////////////////////////////////////////////////////////
    const finalLayerSolid = applyCavitiesToLayer(
      sb,
      layerBlockSolidId,
      cavitySolidIds,
    );

    finalLayerSolidIds.push(finalLayerSolid);

    ///////////////////////////////////////////////////////////////
    // Advance Z for next layer (stack upward)
    ///////////////////////////////////////////////////////////////
    currentBottomZmm += inToMm(thicknessIn);
  }

  ///////////////////////////////////////////////////////////////
  // Add SHAPE_REPRESENTATION
  ///////////////////////////////////////////////////////////////
  const repCtx = sb.add(
    `GEOMETRIC_REPRESENTATION_CONTEXT(3) REPRESENTATION_CONTEXT('', '')`,
  );

  const solidsList = finalLayerSolidIds.map((id) => `#${id}`).join(",");

  sb.add(
    `SHAPE_REPRESENTATION('Foam Layers', (${solidsList}), #${repCtx})`,
  );

  ///////////////////////////////////////////////////////////////
  // Wrap in ISO-10303-21 container
  ///////////////////////////////////////////////////////////////
  const header = `
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Foam layout | Quote ${quoteNo}'),'2;1');
FILE_NAME('${quoteNo}.step','${new Date().toISOString()}',(),(),'Alex-IO','alex-io.com','Foam STEP export');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
`.trim();

  const data = sb.build();

  const footer = `
ENDSEC;
END-ISO-10303-21;
`.trim();

  return `${header}\n${data}\n${footer}`;
}

///////////////////////////////////////////////////////////////
// END CHUNK 4 — STEP EXPORT COMPLETE
///////////////////////////////////////////////////////////////
