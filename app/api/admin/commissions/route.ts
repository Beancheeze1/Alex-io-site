// app/api/admin/commissions/route.ts
//
// Returns commission summary for all sales reps in the tenant.
//
// IMPORTANT: quote_items.price_total_usd is NULL for most quotes because
// pricing is computed on-the-fly by the print route (not stored at creation).
// We replicate that same runtime pricing here by calling /api/quotes/calc
// for each line item — the same approach used in /api/quote/print/route.ts.
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}
function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

export type CommissionRow = {
  user_id: number;
  name: string;
  email: string;
  sales_slug: string;
  commission_pct: number | null;
  quote_count: number;
  quotes_total_usd: number;
  commission_usd: number;
};

type QuoteItemRow = {
  id: number;
  quote_id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  price_total_usd: string | null;
  notes: string | null;
};

type BoxRow = {
  extended_price_usd: string | null;
};

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isLayoutOrPackagingRow(notes: string | null): boolean {
  const n = String(notes || "").toUpperCase();
  return (
    n.includes("[LAYOUT-LAYER]") ||
    n.includes("[PACKAGING]") ||
    n.includes("REQUESTED SHIPPING CARTON")
  );
}

/** Mirror of priceViaCalcRoute in print/route.ts */
async function priceItem(params: {
  base: string;
  L: number;
  W: number;
  H: number;
  qty: number;
  material_id: number;
}): Promise<number> {
  try {
    const url = `${params.base}/api/quotes/calc?t=${Date.now()}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        length_in: params.L,
        width_in: params.W,
        height_in: params.H,
        material_id: params.material_id,
        qty: params.qty,
        cavities: [],
        round_to_bf: false,
      }),
    });
    const j = await r.json().catch(() => ({}));
    const total =
      safeNum(j?.result?.total) ||
      safeNum(j?.result?.price_total) ||
      safeNum(j?.result?.order_total) ||
      safeNum(j?.total) ||
      0;
    return total;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") {
      return bad({ ok: false, error: "forbidden" }, 403);
    }

    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const tenantId = user.tenant_id;

    // Ensure commission_pct column exists
    await one(
      `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT NULL`,
      [],
    ).catch(() => null);

    // Get all sales reps with a slug for this tenant
    const reps = await q<{
      user_id: number;
      name: string;
      email: string;
      sales_slug: string;
      commission_pct: number | null;
    }>(
      `SELECT id AS user_id, name, email, sales_slug, commission_pct
       FROM public.users
       WHERE tenant_id = $1
         AND sales_slug IS NOT NULL
         AND sales_slug <> ''
       ORDER BY name ASC`,
      [tenantId],
    );

    if (!reps || reps.length === 0) {
      return ok({ ok: true, rows: [] });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    // For each rep, compute their real quote total by pricing each item
    const rows: CommissionRow[] = await Promise.all(
      reps.map(async (rep) => {
        // Get all quotes for this rep
        const quotes = await q<{ id: number }>(
          `SELECT id FROM public.quotes WHERE sales_rep_id = $1 AND tenant_id = $2`,
          [rep.user_id, tenantId],
        );

        const quoteIds = quotes.map((r) => r.id);
        if (quoteIds.length === 0) {
          return {
            ...rep,
            quote_count: 0,
            quotes_total_usd: 0,
            commission_usd: 0,
          };
        }

        // Get all line items for these quotes
        const items = await q<QuoteItemRow>(
          `SELECT id, quote_id, length_in, width_in, height_in, qty, material_id, price_total_usd, notes
           FROM public.quote_items
           WHERE quote_id = ANY($1::int[])`,
          [quoteIds],
        );

        // Get all box selection totals for these quotes
        const boxes = await q<BoxRow>(
          `SELECT extended_price_usd
           FROM public.quote_box_selections
           WHERE quote_id = ANY($1::int[])`,
          [quoteIds],
        );

        const boxTotal = boxes.reduce((s, b) => s + safeNum(b.extended_price_usd), 0);

        // Price each foam item — use stored value if present, otherwise call calc
        const foamPrices = await Promise.all(
          items
            .filter((it) => !isLayoutOrPackagingRow(it.notes))
            .map(async (it) => {
              // Use stored price if it was previously repriced
              if (it.price_total_usd !== null && safeNum(it.price_total_usd) > 0) {
                return safeNum(it.price_total_usd);
              }

              const L = Number(it.length_in);
              const W = Number(it.width_in);
              const H = Number(it.height_in);
              const qty = Number(it.qty);
              const materialId = Number(it.material_id);

              if (
                ![L, W, H].every((n) => Number.isFinite(n) && n > 0) ||
                !(qty > 0) ||
                !(materialId > 0)
              ) {
                return 0;
              }

              return priceItem({ base, L, W, H, qty, material_id: materialId });
            }),
        );

        const foamTotal = foamPrices.reduce((s, p) => s + p, 0);
        const quotesTotal = Math.round((foamTotal + boxTotal) * 100) / 100;
        const pct = safeNum(rep.commission_pct);
        const commissionAmt = Math.round(quotesTotal * (pct / 100) * 100) / 100;

        return {
          user_id: rep.user_id,
          name: rep.name,
          email: rep.email,
          sales_slug: rep.sales_slug,
          commission_pct: rep.commission_pct,
          quote_count: quoteIds.length,
          quotes_total_usd: quotesTotal,
          commission_usd: commissionAmt,
        };
      }),
    );

    rows.sort((a, b) => b.quotes_total_usd - a.quotes_total_usd);

    return ok({ ok: true, rows });
  } catch (err: any) {
    console.error("commissions GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}