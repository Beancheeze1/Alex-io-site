// app/api/quote/layout/apply/route.ts
//
// Save a foam layout "package" against a quote.
// Called by the layout editor page (/quote/layout) when the user clicks
// "Apply to quote".
//
// POST JSON:
//   {
//     "quoteNo": "Q-AI-20251121-123456",
//     "layout": { ... LayoutModel ... },
//     "notes": "Loose parts in this pocket",
//     "svg": "<svg>...</svg>",
//     "qty": 100,             // OPTIONAL: new quantity for primary item
//     "materialId": 6,        // OPTIONAL: new material for primary item
//     "customer": {           // OPTIONAL: customer info from editor
//        "name": "Acme Inc.",
//        "email": "buyer@acme.com",
//        "company": "Acme Corporation",
//        "phone": "555-123-4567"
//     }
//   }
//////////////////////////
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Inserts a row into quote_layout_packages with layout_json + notes +
//     svg_text + dxf_text + step_text.
//   - If qty is a positive number, updates the PRIMARY quote_items row for that
//     quote to use the new qty.
//   - If materialId is a positive number, updates the PRIMARY quote_items row
//     for that quote to use the new material, and syncs material info into the
//     facts store.
//   - If customer info is provided from the editor, updates quotes.customer_name,
//     quotes.email, quotes.phone, and quotes.company, and mirrors that into the
//     facts store.
//   - Also syncs dims / cavities / qty / material into the facts store
//     (loadFacts/saveFacts) under quote_no so follow-up emails + layout links
//     use the latest layout, not stale test data.
//   - NEW: syncs each foam layer in layout.stack into quote_items as separate
//     rows marked with notes starting "[LAYOUT-LAYER] ...".
//
 // GET (debug helper):
//   - /api/quote/layout/apply?quote_no=Q-...   -> latest package for that quote

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { buildStepFromLayout } from "@/lib/cad/step";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

/* ===================== Multi-layer-safe cavity flattener ===================== */

type FlatCavity = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number;
  y: number;
};

/**
 * Gather all cavities from a layout in a backward-compatible way.
 *
 * Supports:
 *  - Legacy single-layer layouts:
 *      layout.cavities = [...]
 *  - Future multi-layer layouts:
 *      layout.stack = [{ cavities: [...] }, ...]
 *
 * If both are present, we include both sets (defensive).
 */
function getAllCavitiesFromLayout(layout: any): FlatCavity[] {
  const out: FlatCavity[] = [];

  if (!layout || typeof layout !== "object") return out;

  const pushFrom = (cavs: any[]) => {
    for (const cav of cavs) {
      if (!cav) continue;

      const lengthIn = Number(cav.lengthIn);
      const widthIn = Number(cav.widthIn);
      const depthIn = Number(cav.depthIn);
      const x = Number(cav.x);
      const y = Number(cav.y);

      if (!Number.isFinite(lengthIn) || lengthIn <= 0) continue;
      if (!Number.isFinite(widthIn) || widthIn <= 0) continue;
      if (!Number.isFinite(depthIn) || depthIn <= 0) continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      out.push({ lengthIn, widthIn, depthIn, x, y });
    }
  };

  // Legacy single-layer layouts
  if (Array.isArray(layout.cavities)) {
    pushFrom(layout.cavities);
  }

  // Multi-layer layouts: stack[].cavities[]
  if (Array.isArray(layout.stack)) {
    for (const layer of layout.stack) {
      if (layer && Array.isArray((layer as any).cavities)) {
        pushFrom((layer as any).cavities);
      }
    }
  }

  return out;
}

/* ===================== NEW: Normalize/persist layer thickness into layout_json ===================== */

function coercePositiveNumber(raw: any): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveThicknessFromAny(layerLike: any): number | null {
  if (!layerLike || typeof layerLike !== "object") return null;

  const t =
    (layerLike as any).thicknessIn ??
    (layerLike as any).thickness_in ??
    (layerLike as any).thickness ??
    (layerLike as any).thicknessInches ??
    (layerLike as any).thickness_inches ??
    (layerLike as any).thickness_inch ??
    (layerLike as any).heightIn ??
    (layerLike as any).height_in ??
    null;

  return coercePositiveNumber(t);
}

function normalizeLayoutForStorage(layout: any, body: any): any {
  if (!layout || typeof layout !== "object") return layout;

  // Shallow clone root; clone stack/layers arrays if present.
  const next: any = Array.isArray(layout) ? [...layout] : { ...layout };

  const foamLayers = Array.isArray(body?.foamLayers) ? body.foamLayers : null;

  // Helper to normalize an array of layers (stack or layers)
  const normalizeLayerArray = (arr: any[] | null | undefined) => {
    if (!Array.isArray(arr) || arr.length === 0) return arr;

    return arr.map((layer, idx) => {
      if (!layer || typeof layer !== "object") return layer;

      const copy = { ...(layer as any) };

      // 1) If thickness is already on the layer, normalize to thicknessIn
      let thickness = resolveThicknessFromAny(copy);

      // 2) If missing, try body.foamLayers[idx] (this is the key fix for your current payload)
      if (thickness == null && Array.isArray(foamLayers) && foamLayers[idx]) {
        thickness = resolveThicknessFromAny(foamLayers[idx]);
      }

      // 3) Persist canonical key if we found one
      if (thickness != null) {
        copy.thicknessIn = thickness;
      }

      return copy;
    });
  };

  if (Array.isArray((layout as any).stack)) {
    next.stack = normalizeLayerArray((layout as any).stack);
  }

  if (Array.isArray((layout as any).layers)) {
    next.layers = normalizeLayerArray((layout as any).layers);
  }

  return next;
}

/* ===================== DXF builder from layout (fallback) ===================== */

function buildDxfFromLayout(layout: any): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  let L = Number(block.lengthIn);
  let W = Number(block.widthIn);

  if (!Number.isFinite(L) || L <= 0) return null;
  if (!Number.isFinite(W) || L <= 0) return null;
  if (!Number.isFinite(W) || W <= 0) W = L;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
    return [
      "0",
      "LINE",
      "8",
      "0",
      "10",
      fmt(x1),
      "20",
      fmt(y1),
      "30",
      "0.0",
      "11",
      fmt(x2),
      "21",
      fmt(y2),
      "31",
      "0.0",
    ].join("\n");
  }

  const entities: string[] = [];

  // outer block
  entities.push(lineEntity(0, 0, L, 0));
  entities.push(lineEntity(L, 0, L, W));
  entities.push(lineEntity(L, W, 0, W));
  entities.push(lineEntity(0, W, 0, 0));

  // cavities (flattened) as rectangles
  const allCavities = getAllCavitiesFromLayout(layout);

  for (const cav of allCavities) {
    let cL = cav.lengthIn;
    let cW = cav.widthIn;
    const nx = cav.x;
    const ny = cav.y;

    if (!Number.isFinite(cL) || cL <= 0) continue;
    if (!Number.isFinite(cW) || cW <= 0) cW = cL;
    if (![nx, ny].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) continue;

    const left = L * nx;

    // NOTE: layout y is top-left normalized; DXF is bottom-left
    // So flip Y so it matches SVG orientation.
    const topSvg = W * ny;
    const yCad = W - topSvg - cW;

    entities.push(lineEntity(left, yCad, left + cL, yCad));
    entities.push(lineEntity(left + cL, yCad, left + cL, yCad + cW));
    entities.push(lineEntity(left + cL, yCad + cW, left, yCad + cW));
    entities.push(lineEntity(left, yCad + cW, left, yCad));
  }

  if (!entities.length) return null;

  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    "1",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ].join("\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\n");
  return [header, entities.join("\n"), footer].join("\n");
}

/* ===================== DXF builder from SVG (preferred) ===================== */

function buildDxfFromSvg(svgRaw: string | null): string | null {
  if (!svgRaw || typeof svgRaw !== "string") return null;

  const svg = svgRaw;

  // Extract viewBox: "minX minY width height"
  const vbMatch = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!vbMatch) return null;

  const vbParts = vbMatch[1].trim().split(/\s+/).map((s) => Number(s));
  if (vbParts.length !== 4) return null;

  const vbW = vbParts[2];
  const vbH = vbParts[3];
  if (!Number.isFinite(vbW) || !Number.isFinite(vbH) || vbW <= 0 || vbH <= 0) return null;

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
    return [
      "0",
      "LINE",
      "8",
      "0",
      "10",
      fmt(x1),
      "20",
      fmt(y1),
      "30",
      "0.0",
      "11",
      fmt(x2),
      "21",
      fmt(y2),
      "31",
      "0.0",
    ].join("\n");
  }

  function circleEntity(cx: number, cy: number, r: number): string {
    return [
      "0",
      "CIRCLE",
      "8",
      "0",
      "10",
      fmt(cx),
      "20",
      fmt(cy),
      "40",
      fmt(r),
    ].join("\n");
  }

  const entities: string[] = [];

  // --- rects ---
  const rectRe = /<rect\b([^>]*)\/?>/gi;
  let rectM: RegExpExecArray | null = null;
  while ((rectM = rectRe.exec(svg))) {
    const attrs = rectM[1] || "";

    const x = Number((attrs.match(/\bx\s*=\s*"([^"]+)"/i)?.[1] ?? "0"));
    const y = Number((attrs.match(/\by\s*=\s*"([^"]+)"/i)?.[1] ?? "0"));
    const w = Number((attrs.match(/\bwidth\s*=\s*"([^"]+)"/i)?.[1] ?? "0"));
    const h = Number((attrs.match(/\bheight\s*=\s*"([^"]+)"/i)?.[1] ?? "0"));

    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    // Flip Y to DXF space
    const yCad = vbH - y - h;

    entities.push(lineEntity(x, yCad, x + w, yCad));
    entities.push(lineEntity(x + w, yCad, x + w, yCad + h));
    entities.push(lineEntity(x + w, yCad + h, x, yCad + h));
    entities.push(lineEntity(x, yCad + h, x, yCad));
  }

  // --- circles ---
  const circleRe = /<circle\b([^>]*)\/?>/gi;
  let circM: RegExpExecArray | null = null;
  while ((circM = circleRe.exec(svg))) {
    const attrs = circM[1] || "";

    const cx = Number((attrs.match(/\bcx\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN"));
    const cySvg = Number((attrs.match(/\bcy\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN"));
    const r = Number((attrs.match(/\br\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN"));

    if (!Number.isFinite(cx) || !Number.isFinite(cySvg) || !Number.isFinite(r) || r <= 0) continue;

    // Flip center Y
    const cy = vbH - cySvg;

    entities.push(circleEntity(cx, cy, r));
  }

  if (!entities.length) return null;

  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    "1",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ].join("\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\n");
  return [header, entities.join("\n"), footer].join("\n");
}

/* ===================== SVG annotator from layout ===================== */

function buildSvgWithAnnotations(
  layout: any,
  svgRaw: string | null,
  materialLegend: string | null,
  quoteNo: string,
): string | null {
  if (!svgRaw || typeof svgRaw !== "string") return svgRaw ?? null;

  let svg = svgRaw as string;

  // 1) Remove any previous <g id="alex-io-notes">...</g> groups.
  svg = svg.replace(
    /<g[^>]*id=["']alex-io-notes["'][^>]*>[\s\S]*?<\/g>/gi,
    "",
  );

  // 2) Remove individual <text> nodes that look like old legends.
  const legendLabelPattern =
    /(NOT TO SCALE|FOAM BLOCK:|FOAM:|BLOCK:|MATERIAL:)/i;

  svg = svg.replace(
    /<text\b[^>]*>[\s\S]*?<\/text>/gi,
    (match) => (legendLabelPattern.test(match) ? "" : match),
  );

  if (!layout || !layout.block) {
    return svg;
  }

  const block = layout.block || {};
  const L = Number(block.lengthIn);
  const W = Number(block.widthIn);
  const T = Number(block.thicknessIn);

  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
    return svg;
  }

  const closeIdx = svg.lastIndexOf("</svg");
  if (closeIdx === -1) return svg;

  const firstTagEnd = svg.indexOf(">");
  if (firstTagEnd === -1 || firstTagEnd > closeIdx) return svg;

  const GEOMETRY_SHIFT_Y = 80;

  let svgOpen = svg.slice(0, firstTagEnd + 1);
  const svgChildren = svg.slice(firstTagEnd + 1, closeIdx);
  const svgClose = svg.slice(closeIdx);

  function bumpLengthAttr(tag: string, attrName: string, delta: number): string {
    const re = new RegExp(`${attrName}\\s*=\\s*"([^"]+)"`);
    const m = tag.match(re);
    if (!m) return tag;
    const original = m[1];
    const numMatch = original.match(/^([0-9.]+)/);
    if (!numMatch) return tag;
    const num = parseFloat(numMatch[1]);
    if (!Number.isFinite(num)) return tag;
    const suffix = original.slice(numMatch[1].length);
    const updated = (num + delta).toString() + suffix;
    return tag.replace(re, `${attrName}="${updated}"`);
  }

  const vbRe = /viewBox\s*=\s*"([^"]+)"/;
  const vbMatch = svgOpen.match(vbRe);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/\s+/);
    if (parts.length === 4) {
      const h = parseFloat(parts[3]);
      if (Number.isFinite(h)) {
        parts[3] = (h + GEOMETRY_SHIFT_Y).toString();
        svgOpen = svgOpen.replace(vbRe, `viewBox="${parts.join(" ")}"`);
      }
    }
  }

  svgOpen = bumpLengthAttr(svgOpen, "height", GEOMETRY_SHIFT_Y);

  const lines: string[] = [];

  const safeQuoteNo = quoteNo && quoteNo.trim().length > 0 ? quoteNo.trim() : "";
  if (safeQuoteNo) lines.push(`QUOTE: ${safeQuoteNo}`);

  lines.push("NOT TO SCALE");

  if (Number.isFinite(T) && T > 0) {
    lines.push(`BLOCK: ${L} x ${W} x ${T} in`);
  } else {
    lines.push(`BLOCK: ${L} x ${W} in (thickness see quote)`);
  }

  if (materialLegend && materialLegend.trim().length > 0) {
    lines.push(`MATERIAL: ${materialLegend.trim()}`);
  }

  if (!lines.length) {
    const geometryGroupOnly = `<g id="alex-io-geometry" transform="translate(0, ${GEOMETRY_SHIFT_Y})">\n${svgChildren}\n</g>`;
    return `${svgOpen}\n${geometryGroupOnly}\n${svgClose}`;
  }

  const textYStart = 20;
  const textYStep = 14;

  const notesTexts = lines
    .map((line, i) => {
      const y = textYStart + i * textYStep;
      return `<text x="50%" y="${y}" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="12" fill="#111827">${line}</text>`;
    })
    .join("");

  const notesGroup = `<g id="alex-io-notes">${notesTexts}</g>`;
  const geometryGroup = `<g id="alex-io-geometry" transform="translate(0, ${GEOMETRY_SHIFT_Y})">\n${svgChildren}\n</g>`;

  return `${svgOpen}\n${notesGroup}\n${geometryGroup}\n${svgClose}`;
}

/* ===================== POST: save layout (+ optional qty/material/customer) ===================== */

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as any;

  if (!body || !body.layout || !body.quoteNo) {
    return bad(
      {
        ok: false,
        error: "missing_fields",
        message:
          "POST body must include at least { quoteNo, layout }. Optional: { notes, svg, qty, materialId, customer }. ",
      },
      400,
    );
  }

  const quoteNo = String(body.quoteNo).trim();
  const layout = body.layout;

  // NEW: normalize layout before saving so layer thickness persists into layout_json.stack[]
  const layoutForSave = normalizeLayoutForStorage(layout, body);

  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim()
      : null;
  const svgRaw =
    typeof body.svg === "string" && body.svg.trim().length > 0
      ? body.svg
      : null;

  if (!quoteNo) {
    return bad(
      {
        ok: false,
        error: "missing_quote_no",
        message: "quoteNo must be a non-empty string.",
      },
      400,
    );
  }

  let currentUserId: number | null = null;
  try {
    const user = await getCurrentUserFromRequest(req);
    if (user) currentUserId = user.id;
  } catch (e) {
    console.error("getCurrentUserFromRequest failed in layout/apply:", e);
  }

  const rawCustomer =
    body.customer && typeof body.customer === "object" ? body.customer : null;

  let customerName: string | null = null;
  let customerEmail: string | null = null;
  let customerPhone: string | null = null;
  let customerCompany: string | null = null;

  if (rawCustomer) {
    const rawName =
      rawCustomer.name ??
      rawCustomer.customerName ??
      rawCustomer.customer_name ??
      null;
    const rawEmail =
      rawCustomer.email ??
      rawCustomer.customerEmail ??
      rawCustomer.customer_email ??
      null;
    const rawPhone =
      rawCustomer.phone ??
      rawCustomer.customerPhone ??
      rawCustomer.customer_phone ??
      null;
    const rawCompany =
      rawCustomer.company ??
      rawCustomer.companyName ??
      rawCustomer.customerCompany ??
      rawCustomer.customer_company ??
      null;

    customerName =
      typeof rawName === "string" && rawName.trim().length > 0
        ? rawName.trim()
        : null;
    customerEmail =
      typeof rawEmail === "string" && rawEmail.trim().length > 0
        ? rawEmail.trim()
        : null;
    customerPhone =
      typeof rawPhone === "string" && rawPhone.trim().length > 0
        ? rawPhone.trim()
        : null;
    customerCompany =
      typeof rawCompany === "string" && rawCompany.trim().length > 0
        ? rawCompany.trim()
        : null;
  }

  const rawMaterialId =
    body.materialId ?? body.material_id ?? body.material ?? null;
  let materialId: number | null = null;
  if (
    rawMaterialId !== null &&
    rawMaterialId !== undefined &&
    rawMaterialId !== ""
  ) {
    const n = Number(rawMaterialId);
    if (Number.isFinite(n) && n > 0) {
      materialId = n;
    }
  }

  try {
    const quote = await one<QuoteRow>(
      `
      select id, quote_no
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "quote_not_found",
          message: `No quote header found for quote_no ${quoteNo}.`,
        },
        404,
      );
    }

    if (customerName || customerEmail || customerPhone || customerCompany) {
      await q(
        `
          update quotes
          set
            customer_name = coalesce($2, customer_name),
            email = coalesce($3, email),
            phone = coalesce($4, phone),
            company = coalesce($5, company),
            updated_by_user_id = coalesce($6, updated_by_user_id)
          where id = $1
        `,
        [
          quote.id,
          customerName,
          customerEmail,
          customerPhone,
          customerCompany,
          currentUserId,
        ],
      );
    }

    let materialLegend: string | null = null;
    let materialNameForFacts: string | null = null;
    let materialFamilyForFacts: string | null = null;
    let materialDensityForFacts: number | null = null;

    if (materialId != null) {
      await q(
        `
          update quote_items
          set material_id = $1
          where id = (
            select id
            from quote_items
            where quote_id = $2
            order by id asc
            limit 1
          )
        `,
        [materialId, quote.id],
      );

      const mat = await one<{
        name: string | null;
        material_family: string | null;
        density_lb_ft3: any;
      }>(
        `
          select
            name,
            material_family,
            density_lb_ft3
          from materials
          where id = $1
        `,
        [materialId],
      );

      if (mat) {
        materialNameForFacts = mat.name ?? null;
        materialFamilyForFacts = mat.material_family ?? null;

        const rawDens: any = (mat as any).density_lb_ft3;
        const densNum =
          typeof rawDens === "number"
            ? rawDens
            : rawDens != null
            ? Number(rawDens)
            : NaN;

        if (Number.isFinite(densNum) && densNum > 0) {
          materialDensityForFacts = densNum;
        }

        const legendParts: string[] = [];
        if (mat.name) legendParts.push(mat.name);
        if (mat.material_family) legendParts.push(mat.material_family);
        if (materialDensityForFacts != null) {
          legendParts.push(`${materialDensityForFacts.toFixed(1)} lb/ft³`);
        }
        if (legendParts.length) {
          materialLegend = legendParts.join(" · ");
        }
      }
    }

    // DXF (preferred): build from raw SVG so circles/rounded shapes match the editor.
    // Fallback: layout-based DXF if SVG is missing.
    const dxfFromSvg = buildDxfFromSvg(svgRaw);
    const dxf = dxfFromSvg ?? buildDxfFromLayout(layoutForSave);

    // STEP via external geometry service (microservice-backed).
    const step = await buildStepFromLayout(layoutForSave, quoteNo, materialLegend ?? null);

    // Annotate SVG (for stored preview)
    const svgAnnotated = buildSvgWithAnnotations(
      layoutForSave,
      svgRaw,
      materialLegend ?? null,
      quoteNo,
    );

    const pkg = await one<LayoutPkgRow>(
      `
      insert into quote_layout_packages (
        quote_id,
        layout_json,
        notes,
        svg_text,
        dxf_text,
        step_text,
        created_by_user_id,
        updated_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $7)
      returning id, quote_id, layout_json, notes, svg_text, dxf_text, step_text, created_at
      `,
      [quote.id, layoutForSave, notes, svgAnnotated, dxf, step, currentUserId],
    );

    let updatedQty: number | null = null;

    if (body.qty !== undefined && body.qty !== null && body.qty !== "") {
      const n = Number(body.qty);
      if (Number.isFinite(n) && n > 0) {
        updatedQty = n;

        await q(
          `
          update quote_items
          set qty = $1
          where id = (
            select id
            from quote_items
            where quote_id = $2
            order by id asc
            limit 1
          )
          `,
          [n, quote.id],
        );
      }
    }

    // ===================== NEW: sync foam layers into quote_items =====================
    try {
      const primaryItem = await one<{
        id: number;
        length_in: any;
        width_in: any;
        height_in: any;
        material_id: any;
        qty: any;
      }>(
        `
        select id, length_in, width_in, height_in, material_id, qty
        from quote_items
        where quote_id = $1
        order by id asc
        limit 1
        `,
        [quote.id],
      );

      const block = layoutForSave && layoutForSave.block ? layoutForSave.block : null;
      const blockL = block ? Number(block.lengthIn ?? block.length_in) || 0 : 0;
      const blockW = block ? Number(block.widthIn ?? block.width_in) || 0 : 0;

      const foamLayers = Array.isArray((body as any)?.foamLayers)
        ? (body as any).foamLayers
        : null;

      // ---- PATH A FIX:
      // Only trust body.foamLayers if it matches the saved stack length.
      // Otherwise use layoutForSave.stack (source of truth).
      const stackLayers = Array.isArray(layoutForSave?.stack) ? layoutForSave.stack : null;

      const useFoamLayers =
        Array.isArray(foamLayers) &&
        foamLayers.length > 0 &&
        Array.isArray(stackLayers) &&
        stackLayers.length > 0 &&
        foamLayers.length === stackLayers.length;

      const layers =
        useFoamLayers
          ? stackLayers // still iterate stack so labels/ordering match; foamLayers used only as thickness fallback
          : Array.isArray(stackLayers) && stackLayers.length > 0
          ? stackLayers
          : Array.isArray(layoutForSave?.layers)
          ? layoutForSave.layers
          : [];

      let baseQty: number | null = null;

      if (updatedQty != null && updatedQty > 0) {
        baseQty = updatedQty;
      } else if (body && body.qty !== undefined && body.qty !== null && body.qty !== "") {
        const qn = Number(body.qty);
        if (Number.isFinite(qn) && qn > 0) baseQty = qn;
      } else if (primaryItem && primaryItem.qty != null) {
        const qn = Number(primaryItem.qty);
        if (Number.isFinite(qn) && qn > 0) baseQty = qn;
      }

      if (baseQty == null) baseQty = 1;

      let baseMaterialId: number | null = null;

      if (materialId != null && Number(materialId) > 0) {
        baseMaterialId = Number(materialId);
      } else if (primaryItem && primaryItem.material_id != null) {
        const mid = Number(primaryItem.material_id);
        if (Number.isFinite(mid) && mid > 0) baseMaterialId = mid;
      } else if (layoutForSave && (layoutForSave.materialId != null || layoutForSave.material_id != null)) {
        const rawMid = layoutForSave.materialId ?? layoutForSave.material_id;
        const mid = Number(rawMid);
        if (Number.isFinite(mid) && mid > 0) baseMaterialId = mid;
      }

      // ===================== PATH A FIX (THIS IS THE BUG FIX) =====================
      // If the layout is SINGLE-LAYER, we should NOT create "[LAYOUT-LAYER]" quote_items rows.
      // But we SHOULD delete any existing ones from earlier runs, to eliminate phantom extra layers.
      const isMultiLayer = Array.isArray(layers) && layers.length > 1;

      if (!isMultiLayer) {
        await q(
          `
          delete from quote_items
          where quote_id = $1
            and notes like '[LAYOUT-LAYER] %'
          `,
          [quote.id],
        );

        console.log("[layout/apply] Single-layer layout: cleaned up [LAYOUT-LAYER] rows and skipped insert", {
          quoteId: quote.id,
          quoteNo,
          layersLen: Array.isArray(layers) ? layers.length : 0,
        });
      } else if (
        !baseMaterialId ||
        blockL <= 0 ||
        blockW <= 0 ||
        !Array.isArray(layers) ||
        layers.length === 0
      ) {
        console.warn("[layout/apply] Skipping foam-layer → quote_items sync", {
          quoteId: quote.id,
          blockL,
          blockW,
          baseQty,
          baseMaterialId,
          layersLen: Array.isArray(layers) ? layers.length : 0,
        });
      } else {
        await q(
          `
          delete from quote_items
          where quote_id = $1
            and notes like '[LAYOUT-LAYER] %'
          `,
          [quote.id],
        );

        let layerIndex = 0;

        for (let i = 0; i < layers.length; i++) {
          const rawLayer = layers[i];
          if (!rawLayer) continue;

          // thickness resolution:
          // 1) use thickness already on the saved stack layer
          // 2) if missing AND foamLayers matches stack length, fallback to foamLayers[i]
          const thicknessFromLayer =
            (rawLayer as any).thicknessIn ??
            (rawLayer as any).thickness_in ??
            (rawLayer as any).thickness;

          let thickness = Number(thicknessFromLayer) || 0;

          if (!(thickness > 0) && useFoamLayers && Array.isArray(foamLayers) && foamLayers[i]) {
            const fallback =
              (foamLayers[i] as any).thicknessIn ??
              (foamLayers[i] as any).thickness_in ??
              (foamLayers[i] as any).thickness ??
              (foamLayers[i] as any).heightIn ??
              (foamLayers[i] as any).height_in;

            thickness = Number(fallback) || 0;
          }

          if (!(thickness > 0)) continue;

          layerIndex += 1;

          const rawLabel =
            (rawLayer as any).label ??
            (rawLayer as any).name ??
            (rawLayer as any).title ??
            null;

          let label =
            typeof rawLabel === "string" && rawLabel.trim().length > 0
              ? rawLabel.trim()
              : null;

          const isBottom =
            (rawLayer as any).isBottom === true ||
            (rawLayer as any).id === "layer-bottom";

          if (!label) {
            label = isBottom ? "Bottom pad" : `Layer ${layerIndex}`;
          }

          const notesForRow = `[LAYOUT-LAYER] ${label}`;

          await q(
            `
            insert into quote_items (
              quote_id,
              product_id,
              length_in,
              width_in,
              height_in,
              material_id,
              qty,
              notes
            )
            values ($1, null, $2, $3, $4, $5, $6, $7)
            `,
            [quote.id, blockL, blockW, thickness, baseMaterialId, baseQty, notesForRow],
          );
        }
      }
      // =================== END PATH A FIX ===================
    } catch (layerErr) {
      console.error(
        "Warning: failed to sync foam layers into quote_items for",
        quoteNo,
        layerErr,
      );
    }
    // =================== END new foam layer sync block ===================

    try {
      const factsKey = quoteNo;
      const prevFacts = await loadFacts(factsKey);
      const nextFacts: any =
        prevFacts && typeof prevFacts === "object" ? { ...prevFacts } : {};

      if (layoutForSave && layoutForSave.block) {
        const Lb = Number(layoutForSave.block.lengthIn) || 0;
        const Wb = Number(layoutForSave.block.widthIn) || 0;
        const Tb = Number(layoutForSave.block.thicknessIn) || 0;
        if (Lb > 0 && Wb > 0 && Tb > 0) {
          nextFacts.dims = `${Lb}x${Wb}x${Tb}`;
        }
      }

      const allCavities = getAllCavitiesFromLayout(layoutForSave);
      if (allCavities.length > 0) {
        const cavDims: string[] = [];
        for (const cav of allCavities) {
          const Lc = cav.lengthIn || 0;
          const Wc = cav.widthIn || 0;
          const Dc = cav.depthIn || 0;
          if (Lc > 0 && Wc > 0 && Dc > 0) {
            cavDims.push(`${Lc}x${Wc}x${Dc}`);
          }
        }

        if (cavDims.length) {
          nextFacts.cavityDims = cavDims;
          nextFacts.cavityCount = cavDims.length;
        } else {
          delete nextFacts.cavityDims;
          delete nextFacts.cavityCount;
        }
      } else {
        delete nextFacts.cavityDims;
        delete nextFacts.cavityCount;
      }

      if (updatedQty != null) {
        nextFacts.qty = updatedQty;
      }

      if (materialId != null) {
        nextFacts.material_id = materialId;
      }
      if (materialNameForFacts) {
        nextFacts.material_name = materialNameForFacts;
      }
      if (materialFamilyForFacts) {
        nextFacts.material_family = materialFamilyForFacts;
      }
      if (materialDensityForFacts != null) {
        nextFacts.material_density_lb_ft3 = materialDensityForFacts;
      }

      if (customerName) nextFacts.customer_name = customerName;
      if (customerEmail) nextFacts.customer_email = customerEmail;
      if (customerPhone) nextFacts.customer_phone = customerPhone;
      if (customerCompany) nextFacts.customer_company = customerCompany;

      if (Object.keys(nextFacts).length > 0) {
        await saveFacts(factsKey, nextFacts);
      }
    } catch (e) {
      console.error("Error syncing layout facts for quote", quoteNo, e);
    }

    return ok(
      {
        ok: true,
        quoteNo,
        packageId: pkg ? pkg.id : null,
        updatedQty,
      },
      200,
    );
  } catch (err) {
    console.error("Error in /api/quote/layout/apply POST:", err);
    return bad(
      {
        ok: false,
        error: "server_error",
        message:
          "There was an unexpected problem saving this layout. Please try again.",
      },
      500,
    );
  }
}

/* ===================== GET: latest layout package (debug) ===================== */

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";

  if (!quoteNo) {
    return bad(
      {
        ok: false,
        error: "MISSING_QUOTE_NO",
        message: "No quote_no was provided in the query string.",
      },
      400,
    );
  }

  try {
    const quote = await one<QuoteRow>(
      `
      select id, quote_no
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "NOT_FOUND",
          message: `No quote found with number ${quoteNo}.`,
        },
        404,
      );
    }

    const layoutPkg = await one<LayoutPkgRow>(
      `
      select
        id,
        quote_id,
        layout_json,
        notes,
        svg_text,
        dxf_text,
        step_text,
        created_at
      from quote_layout_packages
      where quote_id = $1
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    return ok(
      {
        ok: true,
        quote,
        layoutPkg,
      },
      200,
    );
  } catch (err) {
    console.error("Error in /api/quote/layout/apply GET:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading the latest layout package.",
      },
      500,
    );
  }
}
