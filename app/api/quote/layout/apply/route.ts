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
//     "materialId": 6         // OPTIONAL: new material for primary item
//   }
//////////////////////////
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Inserts a row into quote_layout_packages with layout_json + notes +
//     svg_text + dxf_text (STEP left nullable for now).
//   - If qty is a positive number, updates the PRIMARY quote_items row for that
//     quote to use the new qty.
//   - If materialId is a positive number, updates the PRIMARY quote_items row
//     for that quote to use the new material, and syncs material info into the
//     facts store.
//   - Also syncs dims / cavities / qty / material into the facts store
//     (loadFacts/saveFacts) under quote_no so follow-up emails + layout links
//     use the latest layout, not stale test data.
//   - Returns the new package id + (if changed) the updatedQty.
//
// GET (debug helper):
//   - /api/quote/layout/apply?quote_no=Q-...   -> latest package for that quote

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { loadFacts, saveFacts } from "@/app/lib/memory";

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
 *  - layout.cavities: [{ lengthIn, widthIn, depthIn, x, y }, ...]
 *      where x,y are normalized 0–1 coordinates for the top-left of the cavity
 *      relative to the block footprint.
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

  // 2) Cavities as inner rectangles
  if (Array.isArray(layout.cavities)) {
    for (const cav of layout.cavities as any[]) {
      if (!cav) continue;
      let cL = Number(cav.lengthIn);
      let cW = Number(cav.widthIn);
      const nx = Number(cav.x);
      const ny = Number(cav.y);

      if (!Number.isFinite(cL) || cL <= 0) continue;
      if (!Number.isFinite(cW) || cW <= 0) {
        cW = cL; // fallback to square
      }
      if (
        ![nx, ny].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
      ) {
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

/**
 * Takes the raw SVG from the editor and injects a small legend group:
 *
 *   <g id="alex-io-notes">
 *     <text>QUOTE: Q-...</text>
 *     <text>NOT TO SCALE</text>
 *     <text>BLOCK: L x W x T in</text>
 *     <text>MATERIAL: 1.7# Black PE · Polyethylene</text>
 *   </g>
 *
 * The geometry is NOT changed; this only adds text.
 *
 * NOTE:
 *   - We no longer embed cavity lines or free-typed notes here.
 *   - Typed notes stay with the quote (quote_layout_packages.notes)
 *     and show on the print page, but do NOT go into the SVG.
 */
function buildSvgWithAnnotations(
  layout: any,
  svgRaw: string | null,
  materialLegend: string | null,
  quoteNo: string,
): string | null {
  if (!svgRaw || typeof svgRaw !== "string") return svgRaw ?? null;
  if (!layout || !layout.block) return svgRaw;

  // Work on a mutable copy of the SVG string.
  let svg = svgRaw as string;

  // Strip any previous alex-io-notes group so we don't double-stack legends.
  svg = svg.replace(
    /<g[^>]*id=["']alex-io-notes["'][^>]*>[\s\S]*?<\/g>/i,
    "",
  );

  const block = layout.block || {};
  const L = Number(block.lengthIn);
  const W = Number(block.widthIn);
  const T = Number(block.thicknessIn);

  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
    // If dims are garbage, leave SVG unchanged.
    return svg;
  }

  const lines: string[] = [];

  // 1) Quote number
  const safeQuoteNo = quoteNo && quoteNo.trim().length > 0 ? quoteNo.trim() : "";
  if (safeQuoteNo) {
    lines.push(`QUOTE: ${safeQuoteNo}`);
  }

  // 2) Simple scale warning
  lines.push("NOT TO SCALE");

  // 3) Block size (outside foam block)
  if (Number.isFinite(T) && T > 0) {
    lines.push(`BLOCK: ${L} x ${W} x ${T} in`);
  } else {
    lines.push(`BLOCK: ${L} x ${W} in (thickness see quote)`);
  }

  // 4) Material legend, if provided
  if (materialLegend && materialLegend.trim().length > 0) {
    lines.push(`MATERIAL: ${materialLegend.trim()}`);
  }

  if (lines.length === 0) {
    return svg;
  }

  // Insert just before </svg>
  const closeIdx = svg.lastIndexOf("</svg");
  if (closeIdx === -1) {
    // Not a normal SVG; leave it unchanged.
    return svg;
  }

  const textYStart = 20;
  const textYStep = 14;

  const texts = lines
    .map((line, i) => {
      const y = textYStart + i * textYStep;
      return `<text x="16" y="${y}" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="12" fill="#111827">${line}</text>`;
    })
    .join("");

  const notesGroup = `<g id="alex-io-notes">${texts}</g>`;

  const before = svg.slice(0, closeIdx);
  const after = svg.slice(closeIdx);

  return `${before}${notesGroup}\n${after}`;
}

/* ===================== POST: save layout (+ optional qty/material) ===================== */

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as any;

  if (!body || !body.quoteNo || !body.layout) {
    return bad(
      {
        ok: false,
        error: "missing_fields",
        message:
          "POST body must include at least { quoteNo, layout }. Optional: { notes, svg, qty, materialId }. ",
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

    // Annotate SVG (if provided) with quote legend.
    const svgAnnotated = buildSvgWithAnnotations(
      layout,
      svgRaw,
      materialLegend ?? null,
      quoteNo,
    );

    // Insert layout package (now including annotated svg_text, dxf_text, step_text).
    const pkg = await one<LayoutPkgRow>(
      `
      insert into quote_layout_packages (quote_id, layout_json, notes, svg_text, dxf_text, step_text)
      values ($1, $2, $3, $4, $5, $6)
      returning id, quote_id, layout_json, notes, svg_text, dxf_text, step_text, created_at
      `,
      [quote.id, layout, notes, svgAnnotated, dxf, step],
    );

    // Optional: update qty on the PRIMARY quote item for this quote.
    // We treat the "first" item (by id asc) as the primary line.
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

    // Sync layout dims, cavities, qty, and material into the facts store
    // so follow-up emails + layout links stay in sync with the editor.
    try {
      const factsKey = quoteNo;
      const prevFacts = await loadFacts(factsKey);
      const nextFacts: any =
        prevFacts && typeof prevFacts === "object" ? { ...prevFacts } : {};

      // Outside size from the saved block
      if (layout && layout.block) {
        const L = Number(layout.block.lengthIn) || 0;
        const W = Number(layout.block.widthIn) || 0;
        const T = Number(layout.block.thicknessIn) || 0;
        if (L > 0 && W > 0 && T > 0) {
          nextFacts.dims = `${L}x${W}x${T}`;
        }
      }

      // Cavities from the saved layout (LxWxD for each pocket)
      if (layout && Array.isArray(layout.cavities)) {
        const cavDims: string[] = [];
        for (const cav of layout.cavities as any[]) {
          if (!cav) continue;
          const L = Number(cav.lengthIn) || 0;
          const W = Number(cav.widthIn) || 0;
          const D = Number(cav.depthIn) || 0;
          if (L > 0 && W > 0 && D > 0) {
            cavDims.push(`${L}x${W}x${D}`);
          }
        }

        if (cavDims.length) {
          nextFacts.cavityDims = cavDims;
          nextFacts.cavityCount = cavDims.length;
        } else {
          delete nextFacts.cavityDims;
          delete nextFacts.cavityCount;
        }
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
