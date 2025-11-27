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
//     "qty": 100              // OPTIONAL: new quantity for primary item
//   }
//////////////////////////
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Inserts a row into quote_layout_packages with layout_json + notes +
//     svg_text + dxf_text (STEP left nullable for now).
//   - If qty is a positive number, updates the PRIMARY quote_items row for that
//     quote to use the new qty.
//   - Also syncs dims / cavities / qty into the facts store (loadFacts/saveFacts)
//     under quote_no so follow-up emails + layout links use the latest layout,
//     not stale "3x2x1 in a 10x10x2 block" test data.
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

/* ===================== Simple DXF builder from layout ===================== */

/**
 * Very small DXF writer that:
 *  - Draws the foam block as a rectangle from (0,0) to (L,W).
 *  - Draws each cavity as a rectangle inside the block.
 *  - Adds text annotations:
 *      - One note for the foam block with full L × W × T.
 *      - One note for each cavity with L × W × Depth.
 *
 * Layout assumptions (matches editor types, but we DO NOT change them):
 *  - layout.block: { lengthIn, widthIn, thicknessIn }
 *  - layout.cavities: [{ lengthIn, widthIn, depthIn, x, y }, ...]
 *      where x,y are normalized 0–1 coordinates for the top-left of the cavity
 *      relative to the block footprint.
 *
 * We keep this conservative: ASCII DXF, ENTITIES section with LWPOLYLINEs + TEXT.
 */
function buildDxfFromLayout(layout: any): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  const L = Number(block.lengthIn);
  const W = Number(block.widthIn);
  const T = Number(block.thicknessIn);

  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
    return null;
  }

  function fmt(n: number) {
    return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
  }

  function rectLwpolyline(x: number, y: number, w: number, h: number): string {
    // Rect as a closed LWPOLYLINE.
    const x1 = fmt(x);
    const y1 = fmt(y);
    const x2 = fmt(x + w);
    const y2 = fmt(y + h);

    return [
      "0",
      "LWPOLYLINE",
      "8",
      "0", // layer
      "90",
      "4", // number of vertices
      "70",
      "1", // closed polyline
      "10",
      x1,
      "20",
      y1,
      "10",
      x2,
      "20",
      y1,
      "10",
      x2,
      "20",
      y2,
      "10",
      x1,
      "20",
      y2,
      "",
    ].join("\n");
  }

  function textEntity(
    content: string,
    x: number,
    y: number,
    height = 0.25,
  ): string {
    // Simple TEXT entity on layer 0.
    return [
      "0",
      "TEXT",
      "8",
      "0", // layer
      "10",
      fmt(x),
      "20",
      fmt(y),
      "40",
      fmt(height), // text height
      "1",
      content,
      "",
    ].join("\n");
  }

  const entities: string[] = [];

  // 1) Foam block as outer rectangle from (0,0) to (L,W)
  entities.push(rectLwpolyline(0, 0, L, W));

  // Block annotation: show full size including thickness if we have it.
  if (Number.isFinite(T) && T > 0) {
    const blockLabel = `FOAM BLOCK: ${L} x ${W} x ${T} in`;
    // Place text slightly above the block, near the left.
    entities.push(
      textEntity(blockLabel, 0, W + Math.max(W * 0.05, 0.5)),
    );
  } else {
    const blockLabel = `FOAM BLOCK: ${L} x ${W} in (thickness see quote)`;
    entities.push(
      textEntity(blockLabel, 0, W + Math.max(W * 0.05, 0.5)),
    );
  }

  // 2) Cavities as inner rectangles (plus text notes)
  if (Array.isArray(layout.cavities)) {
    let idx = 1;
    for (const cav of layout.cavities as any[]) {
      if (!cav) continue;
      const cL = Number(cav.lengthIn);
      const cW = Number(cav.widthIn);
      const cD = Number(cav.depthIn);
      const nx = Number(cav.x);
      const ny = Number(cav.y);

      if (
        ![cL, cW, nx, ny].every((n) => Number.isFinite(n) && n >= 0) ||
        cL <= 0 ||
        cW <= 0
      ) {
        continue;
      }

      // x,y are normalized top-left; convert to block inches.
      const left = L * nx;
      const top = W * ny;

      entities.push(rectLwpolyline(left, top, cL, cW));

      // Cavity label: "CAVITY n: L x W x D in"
      const depthPart =
        Number.isFinite(cD) && cD > 0 ? `${cD}` : "depth?";
      const label = `CAVITY ${idx}: ${cL} x ${cW} x ${depthPart} in`;
      idx += 1;

      // Place text roughly at the center of the cavity.
      const cx = left + cL / 2;
      const cy = top + cW / 2;
      entities.push(
        textEntity(label, cx, cy, Math.min(cL, cW) * 0.18 || 0.25),
      );
    }
  }

  if (!entities.length) return null;

  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
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
 *     <text>FOAM BLOCK: L x W x T in</text>
 *     <text>CAVITY 1: ...</text>
 *     ...
 *   </g>
 *
 * The geometry is NOT changed; this only adds text.
 */
function buildSvgWithAnnotations(
  layout: any,
  svgRaw: string | null,
): string | null {
  if (!svgRaw || typeof svgRaw !== "string") return svgRaw ?? null;
  if (!layout || !layout.block) return svgRaw;

  const block = layout.block || {};
  const L = Number(block.lengthIn);
  const W = Number(block.widthIn);
  const T = Number(block.thicknessIn);

  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
    // If dims are garbage, leave SVG unchanged.
    return svgRaw;
  }

  const lines: string[] = [];

  if (Number.isFinite(T) && T > 0) {
    lines.push(`FOAM BLOCK: ${L} x ${W} x ${T} in`);
  } else {
    lines.push(`FOAM BLOCK: ${L} x ${W} in (thickness see quote)`);
  }

  if (Array.isArray(layout.cavities)) {
    let idx = 1;
    for (const cav of layout.cavities as any[]) {
      if (!cav) continue;
      const cL = Number(cav.lengthIn);
      const cW = Number(cav.widthIn);
      const cD = Number(cav.depthIn);
      if (!Number.isFinite(cL) || !Number.isFinite(cW) || cL <= 0 || cW <= 0) {
        continue;
      }
      const depthPart =
        Number.isFinite(cD) && cD > 0 ? `${cD}` : "depth?";
      lines.push(
        `CAVITY ${idx}: ${cL} x ${cW} x ${depthPart} in`,
      );
      idx += 1;
    }
  }

  if (lines.length === 0) {
    return svgRaw;
  }

  // Insert just before </svg>
  const closeIdx = svgRaw.lastIndexOf("</svg");
  if (closeIdx === -1) {
    // Not a normal SVG; leave it unchanged.
    return svgRaw;
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

  const before = svgRaw.slice(0, closeIdx);
  const after = svgRaw.slice(closeIdx);

  return `${before}${notesGroup}\n${after}`;
}

/* ===================== POST: save layout (+ optional qty) ===================== */

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as any;

  if (!body || !body.quoteNo || !body.layout) {
    return bad(
      {
        ok: false,
        error: "missing_fields",
        message:
          "POST body must include at least { quoteNo, layout }. Optional: { notes, svg, qty }.",
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

    // Build DXF from the incoming layout; STEP left null for now.
    const dxf = buildDxfFromLayout(layout);
    const step: string | null = null;

    // Annotate SVG (if provided) with foam + cavity notes.
    const svgAnnotated = buildSvgWithAnnotations(layout, svgRaw);

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

    // Sync layout dims, cavities, and optional qty into the facts store
    // for this quote so follow-up emails + layout links stay in sync
    // with the editor instead of older parsed values.
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
        packageId: pkg?.id ?? null,
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
