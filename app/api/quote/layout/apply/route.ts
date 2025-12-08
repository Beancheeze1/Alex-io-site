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
//   - Returns the new package id + (if changed) the updatedQty.
//
// GET (debug helper):
//   - /api/quote/layout/apply?quote_no=Q-...   -> latest package for that quote

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { getCurrentUserFromRequest } from "@/lib/auth";

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

/* ===================== DXF builder from layout (LINES + full header) ===================== */

/**
 * DXF writer that:
 *  - Writes a basic R12-style HEADER with ACADVER + INSUNITS (inches).
 *  - Uses ENTITIES section with:
 *      - Foam block as 4 LINE entities (rectangle).
 *      - Each cavity as 4 LINE entities (rectangle).
 *
 * Layout assumptions (matches editor types, but we DO NOT change them):
 *  - layout.block: { lengthIn, widthIn, thicknessIn }
 *  - Primary cavity geometry comes from:
 *      - layout.cavities (legacy single-layer), or
 *      - layout.stack[].cavities (future multi-layer)
 *    All cavities are flattened for DXF purposes.
 */
function buildDxfFromLayout(layout: any): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  let L = Number(block.lengthIn);
  let W = Number(block.widthIn);

  // Basic sanity / fallback
  if (!Number.isFinite(L) || L <= 0) return null;
  if (!Number.isFinite(W) || W <= 0) {
    W = L; // fallback to square if width is bad
  }

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
    return [
      "0",
      "LINE",
      "8",
      "0", // layer
      "10",
      fmt(x1),
      "20",
      fmt(y1),
      "11",
      fmt(x2),
      "21",
      fmt(y2),
      "",
    ].join("\n");
  }

  const entities: string[] = [];

  // 1) Foam block as outer rectangle from (0,0) to (L,W) – 4 LINES.
  entities.push(lineEntity(0, 0, L, 0));
  entities.push(lineEntity(L, 0, L, W));
  entities.push(lineEntity(L, W, 0, W));
  entities.push(lineEntity(0, W, 0, 0));

  // 2) Cavities as inner rectangles (flattened across all layers)
  const allCavities = getAllCavitiesFromLayout(layout);

  if (allCavities.length > 0) {
    for (const cav of allCavities) {
      let cL = cav.lengthIn;
      let cW = cav.widthIn;
      const nx = cav.x;
      const ny = cav.y;

      if (!Number.isFinite(cL) || cL <= 0) continue;
      if (!Number.isFinite(cW) || cW <= 0) {
        cW = cL; // fallback to square
      }
      if (![nx, ny].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
        continue;
      }

      // x,y are normalized top-left; convert to block inches.
      const left = L * nx;
      const top = W * ny;

      entities.push(lineEntity(left, top, left + cL, top));
      entities.push(lineEntity(left + cL, top, left + cL, top + cW));
      entities.push(lineEntity(left + cL, top + cW, left, top + cW));
      entities.push(lineEntity(left, top + cW, left, top));
    }
  }

  if (!entities.length) return null;

  // Full-ish R12-style DXF with HEADER / TABLES / BLOCKS / ENTITIES.
  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009", // R12
    "9",
    "$INSUNITS",
    "70",
    "1", // 1 = inches
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

  // 3) We need basic layout info for dynamic block text; if it's missing, just
  //    leave the SVG as-is (with geometry only).
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
  if (closeIdx === -1) {
    return svg;
  }

  const firstTagEnd = svg.indexOf(">");
  if (firstTagEnd === -1 || firstTagEnd > closeIdx) {
    return svg;
  }

  const GEOMETRY_SHIFT_Y = 80;

  let svgOpen = svg.slice(0, firstTagEnd + 1); // <svg ...>
  const svgChildren = svg.slice(firstTagEnd + 1, closeIdx); // inner content
  const svgClose = svg.slice(closeIdx); // </svg ...>

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
  if (safeQuoteNo) {
    lines.push(`QUOTE: ${safeQuoteNo}`);
  }

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

  const rebuilt = `${svgOpen}\n${notesGroup}\n${geometryGroup}\n${svgClose}`;
  return rebuilt;
}

/* ===================== POST: save layout (+ optional qty/material/customer) ===================== */

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as any;

  if (!body || !body.quoteNo || !body.layout) {
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

  // Current user (if logged in). We fail soft here: layout save still works
  // even if auth is misconfigured; user_id columns just stay null.
  let currentUserId: number | null = null;
  try {
    const user = await getCurrentUserFromRequest(req);
    if (user) currentUserId = user.id;
  } catch (e) {
    console.error("getCurrentUserFromRequest failed in layout/apply:", e);
  }

  // Optional customer info from the layout editor
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

  // Material coming from the layout editor
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

    // Optional: update customer info on the quote using editor input
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

    // Material details (for facts + SVG legend)
    let materialLegend: string | null = null;
    let materialNameForFacts: string | null = null;
    let materialFamilyForFacts: string | null = null;
    let materialDensityForFacts: number | null = null;

    if (materialId != null) {
      // Update the PRIMARY quote item to this material
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

    // Build DXF from the incoming layout; STEP left null for now.
    const dxf = buildDxfFromLayout(layout);
    const step: string | null = null;

    // Clean + re-annotate SVG (if provided) with quote legend and shifted geometry.
    const svgAnnotated = buildSvgWithAnnotations(
      layout,
      svgRaw,
      materialLegend ?? null,
      quoteNo,
    );

    // Insert layout package (now including annotated svg_text, dxf_text, step_text, and user ids).
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
      [quote.id, layout, notes, svgAnnotated, dxf, step, currentUserId],
    );

    // Optional: update qty on the PRIMARY quote item for this quote.
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
    // This does NOT change existing lines; it appends per-layer rows marked with a
    // special notes prefix so we can safely overwrite them on each Apply.
    try {
      // Primary line (if it exists). We now treat this as OPTIONAL.
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

      // Block footprint from the incoming layout
      const block = layout && layout.block ? layout.block : null;
      const blockL = block
        ? Number(block.lengthIn ?? block.length_in) || 0
        : 0;
      const blockW = block
        ? Number(block.widthIn ?? block.width_in) || 0
        : 0;

            // Layers from foamLayers (payload-level) if present,
      // otherwise layout.stack (primary) or layout.layers (fallback)
      const foamLayers = Array.isArray((body as any)?.foamLayers)
        ? (body as any).foamLayers
        : null;

      const layers =
        Array.isArray(foamLayers) && foamLayers.length > 0
          ? foamLayers
          : Array.isArray(layout?.stack)
          ? layout.stack
          : Array.isArray(layout?.layers)
          ? layout.layers
          : [];


      // Derive a base quantity to use for all layer rows.
      let baseQty: number | null = null;

      if (updatedQty != null && updatedQty > 0) {
        baseQty = updatedQty;
      } else if (body && body.qty !== undefined && body.qty !== null && body.qty !== "") {
        const qn = Number(body.qty);
        if (Number.isFinite(qn) && qn > 0) {
          baseQty = qn;
        }
      } else if (primaryItem && primaryItem.qty != null) {
        const qn = Number(primaryItem.qty);
        if (Number.isFinite(qn) && qn > 0) {
          baseQty = qn;
        }
      }

      // If all else fails, fall back to 1 so we at least get visible rows.
      if (baseQty == null) {
        baseQty = 1;
      }

      // Derive a material id to use for all layer rows.
      let baseMaterialId: number | null = null;

      if (materialId != null && Number(materialId) > 0) {
        baseMaterialId = Number(materialId);
      } else if (primaryItem && primaryItem.material_id != null) {
        const mid = Number(primaryItem.material_id);
        if (Number.isFinite(mid) && mid > 0) {
          baseMaterialId = mid;
        }
      } else if (
        layout &&
        (layout.materialId != null || layout.material_id != null)
      ) {
        const rawMid = layout.materialId ?? layout.material_id;
        const mid = Number(rawMid);
        if (Number.isFinite(mid) && mid > 0) {
          baseMaterialId = mid;
        }
      }

      // If we still don't have a material id, we can't safely insert rows.
      if (!baseMaterialId || blockL <= 0 || blockW <= 0 || !Array.isArray(layers) || layers.length === 0) {
        console.warn("[layout/apply] Skipping foam-layer → quote_items sync", {
          quoteId: quote.id,
          blockL,
          blockW,
          baseQty,
          baseMaterialId,
          layersLen: Array.isArray(layers) ? layers.length : 0,
        });
      } else {
        // Clear out any previous auto-generated layer rows to avoid duplicates.
        await q(
          `
          delete from quote_items
          where quote_id = $1
            and notes like '[LAYOUT-LAYER] %'
          `,
          [quote.id],
        );

        let layerIndex = 0;

        for (const rawLayer of layers) {
          if (!rawLayer) continue;

          const thicknessRaw =
            (rawLayer as any).thicknessIn ??
            (rawLayer as any).thickness_in ??
            (rawLayer as any).thickness;

          const thickness = Number(thicknessRaw) || 0;
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
            [
              quote.id,
              blockL,
              blockW,
              thickness,
              baseMaterialId,
              baseQty,
              notesForRow,
            ],
          );
        }
      }
    } catch (layerErr) {
      // Non-fatal: if this fails, the rest of the layout save still succeeds.
      console.error(
        "Warning: failed to sync foam layers into quote_items for",
        quoteNo,
        layerErr,
      );
    }
    
    // =================== END new foam layer sync block ===================

    // Sync layout dims, cavities, qty, material, and customer into the facts store
    try {
      const factsKey = quoteNo;
      const prevFacts = await loadFacts(factsKey);
      const nextFacts: any =
        prevFacts && typeof prevFacts === "object" ? { ...prevFacts } : {};

      if (layout && layout.block) {
        const Lb = Number(layout.block.lengthIn) || 0;
        const Wb = Number(layout.block.widthIn) || 0;
        const Tb = Number(layout.block.thicknessIn) || 0;
        if (Lb > 0 && Wb > 0 && Tb > 0) {
          nextFacts.dims = `${Lb}x${Wb}x${Tb}`;
        }
      }

      const allCavities = getAllCavitiesFromLayout(layout);
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

      if (customerName) {
        nextFacts.customer_name = customerName;
      }
      if (customerEmail) {
        nextFacts.customer_email = customerEmail;
      }
      if (customerPhone) {
        nextFacts.customer_phone = customerPhone;
      }
      if (customerCompany) {
        nextFacts.customer_company = customerCompany;
      }

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
