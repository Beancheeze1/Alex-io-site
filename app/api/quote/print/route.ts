// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no, and attaches pricing snapshot.
//
// IMPORTANT:
// - Supports PRE-APPLY interactive quotes using facts only
// - Automatically switches to DB-backed items after Apply
// - Single authoritative response for the interactive quote page
//
// PRICING (FIX):
// - Interactive quote pricing MUST match the email pricing engine.
// - Therefore, DO NOT use computePricingBreakdown() here.
// - Always price via POST /api/quotes/calc (authoritative volumetric route).
// - We pass cavities: [] and round_to_bf: false to match email behavior.
// - POST-APPLY: do NOT price "included" layer rows (reference-only).
//   Only the primary/billable foam set should be priced.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { buildLayoutExports, computeGeometryHash } from "@/app/lib/layout/exports";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { getPricingSettings } from "@/app/lib/pricing/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================
   Types
   ============================================================ */

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
  created_at: string;
  locked?: boolean | null;
  geometry_hash?: string | null;

  // NEW: revision label (customer workflow language)
  // Source (Path A): facts.revision (default RevAS) until DB is wired.
  revision?: string | null;
};

type ItemRow = {
  id: number;
  quote_id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  material_name: string | null;
  material_family?: string | null;
  density_lb_ft3?: number | null;
  notes?: string | null;
  price_unit_usd?: number | null;
  price_total_usd?: number | null;
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

export type PackagingLine = {
  id: number;
  quote_id: number;
  box_id: number;
  sku: string;
  qty: number;
  unit_price_usd: number | null;
  extended_price_usd: number | null;
  vendor: string | null;
  style: string | null;
  description: string | null;
  inside_length_in: number | null;
  inside_width_in: number | null;
  inside_height_in: number | null;
};

/* ============================================================
   Helpers
   ============================================================ */

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function parseDimsString(dims: string | object | null | undefined) {
  if (!dims) return null;

  // Handle object form: { L, W, H } (stored by persistCustomerBox in layout editor)
  if (typeof dims === "object") {
    const obj = dims as any;
    const L = Number(obj.L);
    const W = Number(obj.W);
    const H = Number(obj.H);
    if ([L, W, H].every((n) => Number.isFinite(n) && n > 0)) return { L, W, H };
    return null;
  }

  // Handle string form: "LxWxH"
  const [L, W, H] = String(dims)
    .split("x")
    .map((s) => Number(String(s).trim()));
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { L, W, H };
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRevLabel(s?: string | null): string {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.toLowerCase().startsWith("rev") ? t.slice(3).trim() : t;
}

function pickDisplayRevision(facts: any, locked: boolean): string {
  if (locked) {
    const r = normalizeRevLabel(facts?.released_rev || facts?.revision || "");
    return r && !r.endsWith("S") ? r : r.replace(/S$/i, "");
  }
  const s = normalizeRevLabel(facts?.stage_rev || facts?.revision || "");
  return s || "AS";
}

/**
 * Identify layout-generated reference-only rows.
 * [LAYOUT-LAYER] rows must NEVER be priced.
 */
function isLayoutLayerRow(it: ItemRow): boolean {
  const notes = String(it?.notes || "").toUpperCase();
  return notes.includes("[LAYOUT-LAYER]");
}

/**
 * Identify box/packaging items that should NOT be foam-priced.
 * Box items are priced separately via quote_box_selections.
 */
function isPackagingItem(it: ItemRow): boolean {
  const notes = String(it?.notes || "");
  return notes.includes("Requested shipping carton") || notes.includes("[PACKAGING]");
}

type BoxMatchRow = {
  id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
};

type BoxPriceTierRow = {
  base_unit_price: string | number | null;
  tier1_min_qty: number | null; tier1_unit_price: string | number | null;
  tier2_min_qty: number | null; tier2_unit_price: string | number | null;
  tier3_min_qty: number | null; tier3_unit_price: string | number | null;
  tier4_min_qty: number | null; tier4_unit_price: string | number | null;
};

/**
 * Find the closest matching stock box for given inside dims + qty, and price it.
 * Tries both orientations (L/W swapped). Returns null if no match found.
 */
async function findAndPriceClosestBox(
  insideL: number,
  insideW: number,
  insideH: number,
  qty: number,
): Promise<{
  box: BoxMatchRow;
  unit_price_usd: number | null;
  extended_price_usd: number | null;
} | null> {
  // Fetch boxes that fit in either orientation, ordered by smallest volume first (tightest fit)
  const candidates = await q<BoxMatchRow>(
    `
    select id, sku, vendor, style, description,
           inside_length_in, inside_width_in, inside_height_in
    from public.boxes
    where (
      (inside_length_in >= $1 and inside_width_in >= $2 and inside_height_in >= $3)
      or
      (inside_length_in >= $2 and inside_width_in >= $1 and inside_height_in >= $3)
    )
    order by inside_length_in * inside_width_in * inside_height_in asc
    limit 5
    `,
    [insideL, insideW, insideH],
  );

  if (!candidates || candidates.length === 0) return null;

  const best = candidates[0];

  // Look up tier pricing for this box
  const tier = await one<BoxPriceTierRow>(
    `
    select base_unit_price,
           tier1_min_qty, tier1_unit_price,
           tier2_min_qty, tier2_unit_price,
           tier3_min_qty, tier3_unit_price,
           tier4_min_qty, tier4_unit_price
    from public.box_price_tiers
    where box_id = $1
    `,
    [best.id],
  );

  const safeN = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  let unitPrice: number | null = tier ? safeN(tier.base_unit_price) : null;

  if (tier) {
    const tiers = [
      { min: tier.tier1_min_qty, unit: safeN(tier.tier1_unit_price) },
      { min: tier.tier2_min_qty, unit: safeN(tier.tier2_unit_price) },
      { min: tier.tier3_min_qty, unit: safeN(tier.tier3_unit_price) },
      { min: tier.tier4_min_qty, unit: safeN(tier.tier4_unit_price) },
    ].filter((t) => t.min != null && (t.min as number) > 0);

    for (const t of tiers) {
      if (t.unit != null && qty >= (t.min as number)) unitPrice = t.unit;
    }
  }

  const extendedPrice = unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null;

  return { box: best, unit_price_usd: unitPrice, extended_price_usd: extendedPrice };
}

/**
 * Authoritative pricing call: POST /api/quotes/calc
 * - MUST match initial email pricing.
 * - We intentionally pass cavities: [] and round_to_bf: false to match your email flow.
 */
async function priceViaCalcRoute(params: {
  L: number;
  W: number;
  H: number;
  qty: number;
  material_id: number;
}): Promise<{ unit: number; total: number; raw: any | null }> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const url = `${base}/api/quotes/calc?t=${Date.now()}`;

  const payload = {
    length_in: params.L,
    width_in: params.W,
    height_in: params.H,
    material_id: params.material_id,
    qty: params.qty,
    cavities: [], // match email (no cavity subtraction)
    round_to_bf: false,
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({} as any));

  // Route returns { ok:true, result:{ total, ... } }
  const total =
    safeNum(j?.result?.total) ??
    safeNum(j?.result?.price_total) ??
    safeNum(j?.result?.order_total) ??
    safeNum(j?.total) ??
    0;

  const qty = Number(params.qty) > 0 ? Number(params.qty) : 0;
  const unit = qty > 0 ? total / qty : 0;

  return {
    unit: Number.isFinite(unit) ? unit : 0,
    total: Number.isFinite(total) ? total : 0,
    raw: j || null,
  };
}

/* ============================================================
   Main handler
   ============================================================ */

export async function GET(req: NextRequest) {
  const quoteNo = req.nextUrl.searchParams.get("quote_no");
  if (!quoteNo) {
    return bad({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  }

  // Tenant guard (single-axis): require auth and scope quote lookup by tenant_id.
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) {
    return bad({ ok: false, error: "UNAUTHORIZED", message: "Login required." }, 401);
  }

  try {
    /* ---------------- Quote header ---------------- */

    const quote = await one<QuoteRow>(
      `
      select
        id,
        quote_no,
        customer_name,
        email,
        phone,
        company,
        status,
        created_at,
        locked,
        geometry_hash
      from quotes
      where quote_no = $1
        and tenant_id = $2
      `,
      [quoteNo, user.tenant_id],
    );

    if (!quote) {
      return bad({ ok: false, error: "NOT_FOUND" }, 404);
    }

    /* ---------------- Load facts (authoritative pre-Apply) ---------------- */

    const facts = (await loadFacts(quoteNo)) || {};

    const locked = !!(quote as any)?.locked;
    const revision = pickDisplayRevision(facts as any, locked);

    // Attach revision to the quote header we return.
    // This does NOT require DB schema changes and is safe for current consumers.
    (quote as any).revision = revision;

    /* ---------------- DB items (post-Apply) ---------------- */

    const itemsRaw = await q<ItemRow>(
      `
      select
        qi.id,
        qi.quote_id,
        qi.length_in,
        qi.width_in,
        qi.height_in,
        qi.qty,
        qi.material_id,
        m.name as material_name,
        m.material_family,
        m.density_lb_ft3,
        qi.notes
      from quote_items qi
      left join materials m on m.id = qi.material_id
      where qi.quote_id = $1
      order by qi.id asc
      `,
      [quote.id],
    );

    let items: ItemRow[] = [];

    /* ============================================================
       PRE-APPLY PATH (facts only, no DB items)
       ============================================================ */

    if (itemsRaw.length === 0) {
      const dimsParsed = parseDimsString((facts as any).dims);

      const qty = safeNum((facts as any).qty);
      const materialId = safeNum((facts as any).material_id);

      if (dimsParsed && qty && qty > 0 && materialId && materialId > 0) {
        const priced = await priceViaCalcRoute({
          L: dimsParsed.L,
          W: dimsParsed.W,
          H: dimsParsed.H,
          qty,
          material_id: materialId,
        });

        items.push({
          id: -1,
          quote_id: quote.id,
          length_in: String(dimsParsed.L),
          width_in: String(dimsParsed.W),
          height_in: String(dimsParsed.H),
          qty: Number(qty),
          material_id: Number(materialId),
          material_name: (facts as any).material_name || null,
          material_family: (facts as any).material_family || null,
          density_lb_ft3: null,
          notes: null,
          price_unit_usd: priced.unit,
          price_total_usd: priced.total,
        });
      }
    }

    /* ============================================================
       POST-APPLY PATH (DB authoritative)
       ============================================================ */

    if (itemsRaw.length > 0) {
      for (const it of itemsRaw) {
        try {
          const L = Number(it.length_in);
          const W = Number(it.width_in);
          const H = Number(it.height_in);

          if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) {
            items.push(it);
            continue;
          }

          const qty = Number(it.qty);
          const materialId = Number(it.material_id);

          if (!(qty > 0) || !(materialId > 0)) {
            items.push(it);
            continue;
          }

          // FIX: Do not price box/packaging items as foam.
          // These are priced separately via quote_box_selections.
          if (isPackagingItem(it)) {
            items.push({
              ...it,
              price_unit_usd: null,
              price_total_usd: null,
            });
            continue;
          }

          // FIX: Do not price layout-generated layer rows.
          // These are reference-only and already included in the PRIMARY foam set.
          if (isLayoutLayerRow(it)) {
            items.push({
              ...it,
              price_unit_usd: null,
              price_total_usd: null,
            });
            continue;
          }

          // FIX: Do not price layout-generated layer rows.
          // These are reference-only and already included in the PRIMARY foam set.
          if (isLayoutLayerRow(it)) {
            items.push({
              ...it,
              price_unit_usd: null,
              price_total_usd: null,
            });
            continue;
          }

          const priced = await priceViaCalcRoute({
            L,
            W,
            H,
            qty,
            material_id: materialId,
          });

          items.push({
            ...it,
            price_unit_usd: priced.unit,
            price_total_usd: priced.total,
          });
        } catch {
          items.push(it);
        }
      }
    }

    /* ---------------- Layout package ---------------- */

    let layoutPkg = await one<LayoutPkgRow>(
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

    if (layoutPkg?.layout_json) {
      const storedHash = typeof quote.geometry_hash === "string" ? quote.geometry_hash : "";
      const layoutHash = computeGeometryHash(layoutPkg.layout_json);
      const lockOk = !!quote.locked && storedHash && layoutHash === storedHash;

      if (!lockOk) {
        layoutPkg = {
          ...layoutPkg,
          svg_text: null,
          dxf_text: null,
          step_text: null,
          export_error: !quote.locked ? "LOCK_REQUIRED" : "GEOMETRY_HASH_MISMATCH",
        } as any;
      } else {
        try {
          const bundle = buildLayoutExports(layoutPkg.layout_json);

          layoutPkg = {
            ...layoutPkg,
            svg_text: bundle.svg ?? layoutPkg.svg_text,
            dxf_text: bundle.dxf ?? layoutPkg.dxf_text,
            step_text: bundle.step ?? layoutPkg.step_text,
          };
        } catch (e) {
          console.error("[quote/print] export regeneration failed", e);
        }
      }
    }

    // --- CAD RBAC (A): redact CAD exports unless admin/sales/cs ---
    const role = (user?.role || "").toLowerCase();
    const cadAllowed = role === "admin" || role === "sales" || role === "cs";

    if (layoutPkg && !cadAllowed) {
      layoutPkg = {
        ...layoutPkg,
        svg_text: null,
        dxf_text: null,
        step_text: null,
      };
    }

    /* ---------------- Packaging lines ---------------- */

    const packagingLines: PackagingLine[] = await q(
      `
      select
        qbs.id,
        qbs.quote_id,
        qbs.box_id,
        qbs.sku,
        qbs.qty,
        qbs.unit_price_usd,
        qbs.extended_price_usd,
        b.vendor,
        b.style,
        b.description,
        b.inside_length_in,
        b.inside_width_in,
        b.inside_height_in
      from quote_box_selections qbs
      join boxes b on b.id = qbs.box_id
      where qbs.quote_id = $1
      `,
      [quote.id],
    );

    const customerBox = parseDimsString((facts as any)?.customer_box_in);
    let packagingLinesForDisplay = packagingLines;

    // Track the matched stock box so the client can display it
    let customerBoxMatch: {
      sku: string;
      description: string | null;
      style: string | null;
      inside_length_in: number;
      inside_width_in: number;
      inside_height_in: number;
      unit_price_usd: number | null;
      extended_price_usd: number | null;
    } | null = null;

    if (customerBox) {
      // Derive qty from primary foam item for tier pricing
      const primaryQty = items.length > 0 ? (Number(items[0].qty) || 1) : 1;

      if (packagingLines.length > 0) {
        // A carton was already explicitly picked — override display dims only,
        // keep that carton's own pricing intact.
        packagingLinesForDisplay = packagingLines.map((l) => {
          const baseDesc = typeof l.description === "string" ? l.description : "";
          const note = `Customer box (inside): ${customerBox.L} × ${customerBox.W} × ${customerBox.H} in`;
          const nextDesc = baseDesc ? `${baseDesc} · ${note}` : note;
          return {
            ...l,
            inside_length_in: customerBox.L,
            inside_width_in: customerBox.W,
            inside_height_in: customerBox.H,
            description: nextDesc,
          };
        });
      } else {
        // No carton picked yet — find + price the closest matching stock box
        // and inject it as a synthetic packaging line.
        const matched = await findAndPriceClosestBox(
          customerBox.L,
          customerBox.W,
          customerBox.H,
          primaryQty,
        );

        if (matched) {
          customerBoxMatch = {
            sku: matched.box.sku,
            description: matched.box.description,
            style: matched.box.style,
            inside_length_in: matched.box.inside_length_in,
            inside_width_in: matched.box.inside_width_in,
            inside_height_in: matched.box.inside_height_in,
            unit_price_usd: matched.unit_price_usd,
            extended_price_usd: matched.extended_price_usd,
          };

          // Synthetic line — id -1 flags it as not yet committed to DB
          packagingLinesForDisplay = [
            {
              id: -1,
              quote_id: quote.id,
              box_id: matched.box.id ?? -1,
              sku: matched.box.sku,
              qty: primaryQty,
              unit_price_usd: matched.unit_price_usd,
              extended_price_usd: matched.extended_price_usd,
              vendor: matched.box.vendor ?? null,
              style: matched.box.style ?? null,
              description: `${matched.box.description ?? matched.box.sku} · Customer box (inside): ${customerBox.L} × ${customerBox.W} × ${customerBox.H} in`,
              inside_length_in: customerBox.L,
              inside_width_in: customerBox.W,
              inside_height_in: customerBox.H,
            } as PackagingLine,
          ];
        }
      }
    }

    // Only count billable priced items toward foam subtotal.
    const foamSubtotal = items.reduce((s, i) => s + (Number(i.price_total_usd) || 0), 0);

    const packagingSubtotal = packagingLinesForDisplay.reduce(
      (s, l) => s + (Number(l.extended_price_usd) || 0),
      0,
    );

    const settings = await getPricingSettings();
    const printingUpcharge =
      facts?.printed === 1 || facts?.printed === "1" || facts?.printed === true
        ? Number(settings.printing_upcharge_usd || 0)
        : 0;

    return ok({
      ok: true,
      quote,
      items,
      layoutPkg,
      packagingLines: packagingLinesForDisplay,
      foamSubtotal,
      packagingSubtotal,
      grandSubtotal: foamSubtotal + packagingSubtotal,
      printingUpcharge,
      grandTotal: foamSubtotal + packagingSubtotal + printingUpcharge,
      isPrinted: !!(facts?.printed === 1 || facts?.printed === "1" || facts?.printed === true),
      customerBoxDims: customerBox ?? null,
      customerBoxMatch,
      facts,
    });
  } catch (err) {
    console.error(err);
    return bad({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}