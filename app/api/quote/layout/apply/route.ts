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
//   - FIX (Path A): After Apply, PRIMARY quote_item height_in must be FULL STACK DEPTH,
//     not the active layer thickness. We set PRIMARY.height_in = sum(stack[].thicknessIn).
//
//   - NEW (Path A, widget-safe): If the quote header does NOT exist yet (common for
//     widget/form → editor direct links), we auto-create a draft quote header
//     so Apply works without needing the email flow.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { buildStepFromLayout } from "@/lib/cad/step";
import { buildLayoutExports } from "@/app/lib/layout/exports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
  status: string | null;
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

      // 2) If missing, try body.foamLayers[idx]
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

  // ✅ normalize corner intent for exports (backward compatible)
  if (next && typeof next === "object" && next.block && typeof next.block === "object") {
    const b: any = next.block;

    const cornerStyle = b.cornerStyle ?? b.corner_style ?? null;
    const croppedLegacy = b.croppedCorners ?? b.cropped_corners ?? null;

    const rawChamfer = b.chamferIn ?? b.chamfer_in ?? null;
    const chamferNum = Number(rawChamfer);
    if (rawChamfer != null && Number.isFinite(chamferNum) && chamferNum >= 0) {
      b.chamferIn = chamferNum;
    }

    // If NEW cornerStyle says chamfer, ensure legacy boolean exists too
    if (cornerStyle === "chamfer" && croppedLegacy == null) {
      b.croppedCorners = true;
    }

    // If legacy says cropped, ensure new cornerStyle exists too
    if ((cornerStyle == null || cornerStyle === "") && croppedLegacy === true) {
      b.cornerStyle = "chamfer";
    }
  }

  return next;
}

/* ===================== NEW: ensure quote header exists (widget/form-safe) ===================== */

async function ensureQuoteHeader(args: {
  quoteNo: string;
  currentUserId: number | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCompany: string | null;
}): Promise<QuoteRow | null> {
  // 1) Try load
  const existing = await one<QuoteRow>(
    `
    select id, quote_no, status
    from quotes
    where quote_no = $1
    `,
    [args.quoteNo],
  );
  if (existing) return existing;

  // IMPORTANT:
  // - quotes.customer_name is NOT NULL in your DB → ALWAYS provide a value
  // - quotes.created_by_user_id does NOT exist in your DB → NEVER reference it
  const fallbackCustomerName =
    typeof args.customerName === "string" && args.customerName.trim().length > 0
      ? args.customerName.trim()
      : "Web Lead";

  // 2) Create (best-effort, tolerant of schema differences)
  // Path A: attempt the most complete insert first; if it fails, fall back safely.
  try {
    // Try with updated_by_user_id (common in your schema)
    const created = await one<QuoteRow>(
      `
      insert into quotes (
        quote_no,
        status,
        customer_name,
        email,
        phone,
        company,
        updated_by_user_id
      )
      values ($1, 'draft', $2, $3, $4, $5, $6)
      returning id, quote_no, status
      `,
      [
        args.quoteNo,
        fallbackCustomerName,
        args.customerEmail,
        args.customerPhone,
        args.customerCompany,
        args.currentUserId,
      ],
    );

    if (created) {
      console.warn("[layout/apply] Auto-created missing quote header (draft)", { quoteNo: args.quoteNo });
      return created;
    }
  } catch (e) {
    console.warn("[layout/apply] Quote header insert (full) failed; will try without updated_by_user_id", {
      quoteNo: args.quoteNo,
      err: String(e),
    });
  }

  try {
    // Try without updated_by_user_id (in case schema differs)
    const created2 = await one<QuoteRow>(
      `
      insert into quotes (
        quote_no,
        status,
        customer_name,
        email,
        phone,
        company
      )
      values ($1, 'draft', $2, $3, $4, $5)
      returning id, quote_no, status
      `,
      [args.quoteNo, fallbackCustomerName, args.customerEmail, args.customerPhone, args.customerCompany],
    );

    if (created2) {
      console.warn("[layout/apply] Auto-created missing quote header (no updated_by_user_id)", { quoteNo: args.quoteNo });
      return created2;
    }
  } catch (e) {
    console.warn("[layout/apply] Quote header insert (no updated_by_user_id) failed; will try minimal", {
      quoteNo: args.quoteNo,
      err: String(e),
    });
  }

  try {
    // Minimal but still satisfies NOT NULL customer_name
    const created3 = await one<QuoteRow>(
      `
      insert into quotes (quote_no, status, customer_name)
      values ($1, 'draft', $2)
      returning id, quote_no, status
      `,
      [args.quoteNo, fallbackCustomerName],
    );

    if (created3) {
      console.warn("[layout/apply] Auto-created missing quote header (minimal)", { quoteNo: args.quoteNo });
      return created3;
    }
  } catch (e) {
    console.error("[layout/apply] Failed to auto-create quote header", {
      quoteNo: args.quoteNo,
      err: String(e),
    });
  }

  return null;
}


/* ===================== NEW: ensure primary quote_items exists ===================== */

function sumLayerThickness(layout: any): number | null {
  const layers = Array.isArray(layout?.stack)
    ? layout.stack
    : Array.isArray(layout?.layers)
      ? layout.layers
      : null;

  if (!Array.isArray(layers) || layers.length === 0) return null;

  let sum = 0;
  let any = false;

  for (const layer of layers) {
    const t = resolveThicknessFromAny(layer);
    if (t != null && t > 0) {
      sum += t;
      any = true;
    }
  }

  return any && sum > 0 ? sum : null;
}

async function ensurePrimaryQuoteItem(args: {
  quoteId: number;
  layoutForSave: any;
  qtyMaybe: number | null;
  materialIdMaybe: number | null;
}) {
  const existingCount = await one<{ c: number }>(
    `select count(*)::int as c from quote_items where quote_id = $1`,
    [args.quoteId],
  );

  if ((existingCount?.c ?? 0) > 0) return;

  const block = args.layoutForSave?.block ?? null;

  const L = Number(block?.lengthIn ?? block?.length_in);
  const W = Number(block?.widthIn ?? block?.width_in);
  let T = Number(block?.thicknessIn ?? block?.thickness_in ?? block?.heightIn ?? block?.height_in);

  if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(W) || W <= 0) {
    console.warn("[layout/apply] Cannot create primary quote_item (missing block dims)", { quoteId: args.quoteId });
    return;
  }

  if (!Number.isFinite(T) || T <= 0) {
    const sumT = sumLayerThickness(args.layoutForSave);
    if (sumT != null) T = sumT;
  }

  if (!Number.isFinite(T) || T <= 0) {
    console.warn("[layout/apply] Cannot create primary quote_item (missing thickness)", { quoteId: args.quoteId });
    return;
  }

  const qty = args.qtyMaybe != null && Number.isFinite(args.qtyMaybe) && args.qtyMaybe > 0 ? args.qtyMaybe : 1;
  const materialId =
    args.materialIdMaybe != null && Number.isFinite(args.materialIdMaybe) && args.materialIdMaybe > 0
      ? args.materialIdMaybe
      : null;

  if (!materialId) {
    console.warn("[layout/apply] Cannot create primary quote_item (missing materialId)", { quoteId: args.quoteId });
    return;
  }

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
    [args.quoteId, L, W, T, materialId, qty, "[PRIMARY] Auto-created by layout/apply"],
  );

  console.warn("[layout/apply] Created missing PRIMARY quote_item", {
    quoteId: args.quoteId,
    L,
    W,
    T,
    materialId,
    qty,
  });
}

/* ===================== DXF builder from layout (fallback) ===================== */

function buildDxfFromLayout(layout: any): string | null {
  if (!layout || !layout.block) return null;

  const block = layout.block || {};
  let L = Number(block.lengthIn);
  let W = Number(block.widthIn);

  if (!Number.isFinite(L) || L <= 0) return null;
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
    ].join("\\n");
  }

  const entities: string[] = [];

  // outer block (optionally chamfered)
  const cornerStyle =
    layout?.block?.cornerStyle ??
    layout?.block?.corner_style ??
    null;

  const croppedLegacy = !!(layout?.block?.croppedCorners ?? layout?.block?.cropped_corners);

  const cropped = cornerStyle === "chamfer" || croppedLegacy;

  const chamferIn =
    Number(layout?.block?.chamferIn ?? layout?.block?.chamfer_in) || 1;

  const canChamfer =
    cropped &&
    Number.isFinite(chamferIn) &&
    chamferIn > 0 &&
    L > chamferIn * 2 &&
    W > chamferIn * 2;

  if (!canChamfer) {
    entities.push(lineEntity(0, 0, L, 0));
    entities.push(lineEntity(L, 0, L, W));
    entities.push(lineEntity(L, W, 0, W));
    entities.push(lineEntity(0, W, 0, 0));
  } else {
    const c = chamferIn;

    // Full 4-corner chamfer in CAD space
    entities.push(lineEntity(c, 0, L - c, 0));
    entities.push(lineEntity(L - c, 0, L, c));
    entities.push(lineEntity(L, c, L, W - c));
    entities.push(lineEntity(L, W - c, L - c, W));
    entities.push(lineEntity(L - c, W, c, W));
    entities.push(lineEntity(c, W, 0, W - c));
    entities.push(lineEntity(0, W - c, 0, c));
    entities.push(lineEntity(0, c, c, 0));
  }

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
  ].join("\\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\\n");
  return [header, entities.join("\\n"), footer].join("\\n");
}

/* ===================== DXF builder from SVG (preferred) ===================== */

function buildDxfFromSvg(svgRaw: string | null): string | null {
  if (!svgRaw || typeof svgRaw !== "string") return null;

  const svg = svgRaw;

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
    ].join("\\n");
  }

  function circleEntity(cx: number, cy: number, r: number): string {
    return ["0", "CIRCLE", "8", "0", "10", fmt(cx), "20", fmt(cy), "40", fmt(r)].join("\\n");
  }

  function arcEntity(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
    return [
      "0",
      "ARC",
      "8",
      "0",
      "10",
      fmt(cx),
      "20",
      fmt(cy),
      "40",
      fmt(r),
      "50",
      fmt(startDeg),
      "51",
      fmt(endDeg),
    ].join("\\n");
  }

  const entities: string[] = [];

  // --- RECTs ---
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

    const rxRaw = attrs.match(/\brx\s*=\s*"([^"]+)"/i)?.[1] ?? null;
    const ryRaw = attrs.match(/\bry\s*=\s*"([^"]+)"/i)?.[1] ?? null;

    const rxNum = rxRaw == null ? NaN : Number(rxRaw);
    const ryNum = ryRaw == null ? NaN : Number(ryRaw);

    let r = 0;
    if (Number.isFinite(rxNum) || Number.isFinite(ryNum)) {
      const rr = Number.isFinite(rxNum) ? rxNum : Number.isFinite(ryNum) ? ryNum : 0;
      const rr2 = Number.isFinite(ryNum) ? ryNum : rr;
      r = Math.max(0, Math.min(rr, rr2, w / 2, h / 2));
    }

    const yCad = vbH - y - h;

    if (!(r > 0)) {
      entities.push(lineEntity(x, yCad, x + w, yCad));
      entities.push(lineEntity(x + w, yCad, x + w, yCad + h));
      entities.push(lineEntity(x + w, yCad + h, x, yCad + h));
      entities.push(lineEntity(x, yCad + h, x, yCad));
      continue;
    }

    entities.push(lineEntity(x + r, yCad, x + w - r, yCad));
    entities.push(lineEntity(x + r, yCad + h, x + w - r, yCad + h));
    entities.push(lineEntity(x, yCad + r, x, yCad + h - r));
    entities.push(lineEntity(x + w, yCad + r, x + w, yCad + h - r));

    entities.push(arcEntity(x + r, yCad + r, r, 180, 270));
    entities.push(arcEntity(x + w - r, yCad + r, r, 270, 0));
    entities.push(arcEntity(x + w - r, yCad + h - r, r, 0, 90));
    entities.push(arcEntity(x + r, yCad + h - r, r, 90, 180));
  }

  // --- PATHs (supports chamfered outline: M ... L ... Z) ---
  const pathRe = /<path\b([^>]*)\/?>/gi;
  let pathM: RegExpExecArray | null = null;
  while ((pathM = pathRe.exec(svg))) {
    const attrs = pathM[1] || "";
    const d = attrs.match(/\bd\s*=\s*"([^"]+)"/i)?.[1] ?? null;
    if (!d) continue;

    // Only handle simple absolute M/L/Z paths
    // Example: M x y L x y L x y ... Z
    const cmdRe = /([MLZ])([^MLZ]*)/gi;
    const pts: Array<{ x: number; y: number }> = [];
    let start: { x: number; y: number } | null = null;
    let last: { x: number; y: number } | null = null;

    let cm: RegExpExecArray | null = null;
    while ((cm = cmdRe.exec(d))) {
      const cmd = (cm[1] || "").toUpperCase();
      const rest = (cm[2] || "").trim();

      if (cmd === "Z") {
        // close
        if (start && last) {
          pts.push({ x: start.x, y: start.y });
        }
        continue;
      }

      const nums = rest
        .split(/[\s,]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));

      // M and L expect pairs
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i];
        const y = nums[i + 1];
        const p = { x, y };

        if (cmd === "M" && !start) {
          start = p;
        }
        last = p;
        pts.push(p);
      }
    }

    // Need at least 2 points
    if (pts.length < 2) continue;

    // Draw consecutive lines
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) continue;

      const ax = a.x;
      const ayCad = vbH - a.y;
      const bx = b.x;
      const byCad = vbH - b.y;

      entities.push(lineEntity(ax, ayCad, bx, byCad));
    }
  }

  // --- CIRCLEs ---
  const circleRe = /<circle\b([^>]*)\/?>/gi;
  let circM: RegExpExecArray | null = null;
  while ((circM = circleRe.exec(svg))) {
    const attrs = circM[1] || "";

    const cx = Number((attrs.match(/\bcx\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN"));
    const cySvg = Number((attrs.match(/\bcy\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN"));
    const r = Number((attrs.match(/\br\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN"));

    if (!Number.isFinite(cx) || !Number.isFinite(cySvg) || !Number.isFinite(r) || r <= 0) continue;

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
  ].join("\\n");

  const footer = ["0", "ENDSEC", "0", "EOF"].join("\\n");
  return [header, entities.join("\\n"), footer].join("\\n");
}

/* ===================== SERVER FIX: force chamfered block outline in saved SVG ===================== */

function enforceChamferedBlockInSvg(svgRaw: string | null, layout: any): string | null {
  if (!svgRaw || typeof svgRaw !== "string") return svgRaw;

  const cornerStyle = layout?.block?.cornerStyle ?? layout?.block?.corner_style ?? null;
  const croppedLegacy = !!(layout?.block?.croppedCorners ?? layout?.block?.cropped_corners);
  const wantsChamfer = cornerStyle === "chamfer" || croppedLegacy;
  if (!wantsChamfer) return svgRaw;

  const L_in = Number(layout?.block?.lengthIn ?? layout?.block?.length_in);
  const W_in = Number(layout?.block?.widthIn ?? layout?.block?.width_in);
  if (!Number.isFinite(L_in) || L_in <= 0 || !Number.isFinite(W_in) || W_in <= 0) return svgRaw;

  const chamferIn = Number(layout?.block?.chamferIn ?? layout?.block?.chamfer_in);
  if (!Number.isFinite(chamferIn) || chamferIn <= 0) return svgRaw;

  // Find the "main block" rect (first rect that is not fill="none" and has stroke-width="2")
  // This matches what your saved svg_text looks like.
  const rectRe = /<rect\b([^>]*)\/?>/i;
  const m = svgRaw.match(rectRe);
  if (!m) return svgRaw;

  const attrs = m[1] || "";

  // Skip if this rect is clearly a cavity outline (fill="none")
  const fill = attrs.match(/\bfill\s*=\s*"([^"]+)"/i)?.[1] ?? null;
  if (!fill || fill.toLowerCase() === "none") {
    return svgRaw;
  }

  const strokeWidthStr = attrs.match(/\bstroke-width\s*=\s*"([^"]+)"/i)?.[1] ?? null;
  const strokeWidthNum = strokeWidthStr != null ? Number(strokeWidthStr) : NaN;
  if (!(Number.isFinite(strokeWidthNum) && strokeWidthNum >= 2)) {
    // Still allow, but your block usually uses 2
  }

  const x0 = Number(attrs.match(/\bx\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN");
  const y0 = Number(attrs.match(/\by\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN");
  const w = Number(attrs.match(/\bwidth\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN");
  const h = Number(attrs.match(/\bheight\s*=\s*"([^"]+)"/i)?.[1] ?? "NaN");

  if (![x0, y0, w, h].every((n) => Number.isFinite(n))) return svgRaw;
  if (!(w > 0 && h > 0)) return svgRaw;

  // Convert chamfer inches into SVG units based on the block rect scale
  const scaleX = w / L_in;
  const scaleY = h / W_in;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale) || scale <= 0) return svgRaw;

  const c = chamferIn * scale;

  // Must be valid chamfer vs rect size
  if (!(c > 0 && w > c * 2 && h > c * 2)) return svgRaw;

  const x1 = x0 + w;
  const y1 = y0 + h;

  const stroke = attrs.match(/\bstroke\s*=\s*"([^"]+)"/i)?.[1] ?? "#111827";
  const strokeWidth = strokeWidthStr ?? "2";

  // Build 4-corner chamfer path (same as your screenshot logic)
  const d = [
    `M ${(x0 + c).toFixed(2)} ${y0.toFixed(2)}`,
    `L ${(x1 - c).toFixed(2)} ${y0.toFixed(2)}`,
    `L ${x1.toFixed(2)} ${(y0 + c).toFixed(2)}`,
    `L ${x1.toFixed(2)} ${(y1 - c).toFixed(2)}`,
    `L ${(x1 - c).toFixed(2)} ${y1.toFixed(2)}`,
    `L ${(x0 + c).toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x0.toFixed(2)} ${(y1 - c).toFixed(2)}`,
    `L ${x0.toFixed(2)} ${(y0 + c).toFixed(2)}`,
    `Z`,
  ].join(" ");

  const pathTag = `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;

  // Replace ONLY the first rect tag we matched
  return svgRaw.replace(rectRe, pathTag);
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

  svg = svg.replace(/<g\b[^>]*id=["']alex-io-notes["'][^>]*>[\s\S]*?<\/g\s*>/gi, "");

  const legendLabelPattern = /(NOT TO SCALE|FOAM BLOCK:|FOAM:|BLOCK:|MATERIAL:)/i;
  svg = svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gi, (match) => (legendLabelPattern.test(match) ? "" : match));

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
    const geometryGroupOnly = `<g id="alex-io-geometry" transform="translate(0, ${GEOMETRY_SHIFT_Y})">\\n${svgChildren}\\n</g>`;
    return `${svgOpen}\\n${geometryGroupOnly}\\n${svgClose}`;
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
  const geometryGroup = `<g id="alex-io-geometry" transform="translate(0, ${GEOMETRY_SHIFT_Y})">\\n${svgChildren}\\n</g>`;

  return `${svgOpen}\\n${notesGroup}\\n${geometryGroup}\\n${svgClose}`;
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

  const layoutForSave = normalizeLayoutForStorage(layout, body);
  // Build canonical exports from the normalized layout.
  // IMPORTANT: This must honor per-layer cropCorners regardless of active layer.
  const bundle = buildLayoutExports(layoutForSave);
  const notes = typeof body.notes === "string" && body.notes.trim().length > 0 ? body.notes.trim() : null;
  const svgRaw = typeof body.svg === "string" && body.svg.trim().length > 0 ? body.svg : null;

  // ✅ Server-enforced chamfer (fixes broken client checkbox)
  const svgFixed = enforceChamferedBlockInSvg(svgRaw, layoutForSave);

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

  const rawCustomer = body.customer && typeof body.customer === "object" ? body.customer : null;

  let customerName: string | null = null;
  let customerEmail: string | null = null;
  let customerPhone: string | null = null;
  let customerCompany: string | null = null;

  if (rawCustomer) {
    const rawName = rawCustomer.name ?? rawCustomer.customerName ?? rawCustomer.customer_name ?? null;
    const rawEmail = rawCustomer.email ?? rawCustomer.customerEmail ?? rawCustomer.customer_email ?? null;
    const rawPhone = rawCustomer.phone ?? rawCustomer.customerPhone ?? rawCustomer.customer_phone ?? null;
    const rawCompany =
      rawCustomer.company ?? rawCustomer.companyName ?? rawCustomer.customerCompany ?? rawCustomer.customer_company ?? null;

    customerName = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : null;
    customerEmail = typeof rawEmail === "string" && rawEmail.trim().length > 0 ? rawEmail.trim() : null;
    customerPhone = typeof rawPhone === "string" && rawPhone.trim().length > 0 ? rawPhone.trim() : null;
    customerCompany = typeof rawCompany === "string" && rawCompany.trim().length > 0 ? rawCompany.trim() : null;
  }

  const rawMaterialId = body.materialId ?? body.material_id ?? body.material ?? null;
  let materialId: number | null = null;
  if (rawMaterialId !== null && rawMaterialId !== undefined && rawMaterialId !== "") {
    const n = Number(rawMaterialId);
    if (Number.isFinite(n) && n > 0) {
      materialId = n;
    }
  }

  try {
    // ✅ NEW: Widget/form links may not have a quote header yet.
    // Create it (draft) if missing, then continue.
    const quote = await ensureQuoteHeader({
      quoteNo,
      currentUserId,
      customerName,
      customerEmail,
      customerPhone,
      customerCompany,
    });

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "quote_not_found",
          message: `No quote header found for quote_no ${quoteNo}, and auto-create failed.`,
        },
        404,
      );
    }

    // NEW: If quote_items is missing, create the PRIMARY row now (safe self-heal).
    let qtyMaybe: number | null = null;
    if (body.qty !== undefined && body.qty !== null && body.qty !== "") {
      const qn = Number(body.qty);
      if (Number.isFinite(qn) && qn > 0) qtyMaybe = qn;
    }

    const materialIdMaybe =
      materialId != null
        ? materialId
        : layoutForSave && (layoutForSave.materialId != null || layoutForSave.material_id != null)
          ? Number(layoutForSave.materialId ?? layoutForSave.material_id) || null
          : null;

    await ensurePrimaryQuoteItem({
      quoteId: quote.id,
      layoutForSave,
      qtyMaybe,
      materialIdMaybe:
        materialIdMaybe != null && Number.isFinite(materialIdMaybe) && materialIdMaybe > 0
          ? materialIdMaybe
          : null,
    });

    // FIX (Path A): After Apply, PRIMARY must reflect FULL STACK DEPTH so /api/quotes/calc prices the full set.
    try {
      const stackDepthIn = sumLayerThickness(layoutForSave);
      if (stackDepthIn != null && Number.isFinite(stackDepthIn) && stackDepthIn > 0) {
        await q(
          `
          update quote_items
          set height_in = $1
          where id = (
            select id
            from quote_items
            where quote_id = $2
            order by id asc
            limit 1
          )
          `,
          [stackDepthIn, quote.id],
        );
      }
    } catch (e) {
      console.error("[layout/apply] Failed to set PRIMARY height_in to stack depth for", quoteNo, e);
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
        [quote.id, customerName, customerEmail, customerPhone, customerCompany, currentUserId],
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
        const densNum = typeof rawDens === "number" ? rawDens : rawDens != null ? Number(rawDens) : NaN;

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

    // ✅ Canonical exports MUST come from buildLayoutExports(layoutForSave)
    // so per-layer cropCorners is honored regardless of which layer was active.
    const dxf = bundle?.dxf ?? buildDxfFromSvg(svgFixed) ?? buildDxfFromLayout(layoutForSave);

    const step = await buildStepFromLayout(layoutForSave, quoteNo, materialLegend ?? null);

    const svgBase = bundle?.svg ?? svgFixed;
    const svgAnnotated = buildSvgWithAnnotations(layoutForSave, svgBase, materialLegend ?? null, quoteNo);

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

    // ===================== NEW: status progression =====================
    // Draft -> Applied
    // Applied/Revised -> Revised (re-apply means we revised the quote)
    try {
      await q(
        `
        update quotes
        set
          status = case
            when status in ('applied', 'revised') then 'revised'
            else 'applied'
          end,
          updated_by_user_id = coalesce($2, updated_by_user_id)
        where id = $1
        `,
        [quote.id, currentUserId],
      );
    } catch (e) {
      console.error("[layout/apply] Failed to update quote status for", quoteNo, e);
    }
    // =================== END status progression ===================

    // NEW (Path A): Clicking "Apply to quote" should advance the quote status.
    // Keep it conservative: only promote draft → applied; never overwrite later statuses.
    try {
      await q(
        `
        update quotes
        set
          status = case when status = 'draft' then 'applied' else status end,
          updated_by_user_id = coalesce($2, updated_by_user_id)
        where id = $1
        `,
        [quote.id, currentUserId],
      );
    } catch (e) {
      console.error("[layout/apply] Failed to promote quote status to applied for", quoteNo, e);
    }

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

      const foamLayers = Array.isArray((body as any)?.foamLayers) ? (body as any).foamLayers : null;

      const stackLayers = Array.isArray(layoutForSave?.stack) ? layoutForSave.stack : null;

      const useFoamLayers =
        Array.isArray(foamLayers) &&
        foamLayers.length > 0 &&
        Array.isArray(stackLayers) &&
        stackLayers.length > 0 &&
        foamLayers.length === stackLayers.length;

      const layers = useFoamLayers
        ? stackLayers
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
        await q(
          `
          delete from quote_items
          where quote_id = $1
            and notes like '[LAYOUT-LAYER]%'
          `,
          [quote.id],
        );

        let layerIndex = 0;

        for (let i = 0; i < layers.length; i++) {
          const rawLayer = layers[i];
          if (!rawLayer) continue;

          const thicknessFromLayer =
            (rawLayer as any).thicknessIn ?? (rawLayer as any).thickness_in ?? (rawLayer as any).thickness;

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

          const rawLabel = (rawLayer as any).label ?? (rawLayer as any).name ?? (rawLayer as any).title ?? null;

          let label = typeof rawLabel === "string" && rawLabel.trim().length > 0 ? rawLabel.trim() : null;

          const isBottom = (rawLayer as any).isBottom === true || (rawLayer as any).id === "layer-bottom";

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
    } catch (layerErr) {
      console.error("Warning: failed to sync foam layers into quote_items for", quoteNo, layerErr);
    }
    // =================== END new foam layer sync block ===================

    try {
      const factsKey = quoteNo;
      const prevFacts = await loadFacts(factsKey);
      const nextFacts: any = prevFacts && typeof prevFacts === "object" ? { ...prevFacts } : {};

      if (layoutForSave && layoutForSave.block) {
        const Lb = Number(layoutForSave.block.lengthIn) || 0;
        const Wb = Number(layoutForSave.block.widthIn) || 0;

        // FIX (Path A): Facts dims should reflect FULL STACK DEPTH when available.
        const stackDepthIn = sumLayerThickness(layoutForSave);
        const Tb =
          stackDepthIn != null && Number.isFinite(stackDepthIn) && stackDepthIn > 0
            ? stackDepthIn
            : Number(layoutForSave.block.thicknessIn) || 0;

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

    // ===================== NEW (Path A): status transitions =====================
    // Rule:
    //  - If already SENT and we Apply again => REVISED
    //  - If DRAFT and we Apply the first time => APPLIED
    try {
      const prevStatus = (quote?.status ?? "").toLowerCase();

      if (prevStatus === "sent") {
        await q(
          `
          update quotes
          set
            status = 'revised',
            updated_by_user_id = coalesce($2, updated_by_user_id)
          where id = $1
          `,
          [quote.id, currentUserId],
        );
      } else if (prevStatus === "draft") {
        await q(
          `
          update quotes
          set
            status = 'applied',
            updated_by_user_id = coalesce($2, updated_by_user_id)
          where id = $1
          `,
          [quote.id, currentUserId],
        );
      }
    } catch (e) {
      console.error("[layout/apply] status transition failed for", quoteNo, e);
    }
    // =================== END NEW status transitions ===================

    return ok(
      {
        ok: true,
        quoteNo,
        packageId: pkg ? pkg.id : null,
        updatedQty,
        // helpful debug signal (UI can ignore)
        statusHint: "applied",
      },
      200,
    );
  } catch (err) {
    console.error("Error in /api/quote/layout/apply POST:", err);
    return bad(
      {
        ok: false,
        error: "server_error",
        message: "There was an unexpected problem saving this layout. Please try again.",
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
        message: "There was an unexpected problem loading the latest layout package.",
      },
      500,
    );
  }
}
