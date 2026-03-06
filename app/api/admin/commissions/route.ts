// app/api/admin/commissions/route.ts
//
// Returns commission summary for all sales reps in the tenant.
//
// Mirrors /api/quote/print pricing exactly:
// - PRE-APPLY quotes: no quote_items rows — price from Redis facts (dims/qty/material_id)
// - POST-APPLY quotes: price from quote_items rows (or calc if price_total_usd is NULL)
// - Box totals: always from quote_box_selections.extended_price_usd (always stored)
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { loadFacts } from "@/app/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

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

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDims(dims: any): { L: number; W: number; H: number } | null {
  if (!dims) return null;
  if (typeof dims === "object") {
    const L = Number(dims.L), W = Number(dims.W), H = Number(dims.H);
    if ([L, W, H].every((n) => Number.isFinite(n) && n > 0)) return { L, W, H };
    return null;
  }
  const [L, W, H] = String(dims).split("x").map((s) => Number(s.trim()));
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { L, W, H };
}

function isExcludedRow(notes: string | null): boolean {
  const n = String(notes || "").toUpperCase();
  return n.includes("[LAYOUT-LAYER]") || n.includes("[PACKAGING]") || n.includes("REQUESTED SHIPPING CARTON");
}

async function calcTotal(base: string, L: number, W: number, H: number, qty: number, material_id: number): Promise<number> {
  try {
    const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ length_in: L, width_in: W, height_in: H, material_id, qty, cavities: [], round_to_bf: false }),
    });
    const j = await r.json().catch(() => ({}));
    return safeNum(j?.result?.total) || safeNum(j?.result?.price_total) || safeNum(j?.total) || 0;
  } catch { return 0; }
}

async function getQuoteTotal(
  quoteId: number,
  quoteNo: string,
  base: string,
): Promise<number> {
  // Get quote_items
  const items = await q<{
    length_in: string; width_in: string; height_in: string;
    qty: number; material_id: number;
    price_total_usd: string | null; notes: string | null;
  }>(
    `SELECT length_in, width_in, height_in, qty, material_id, price_total_usd, notes
     FROM public.quote_items WHERE quote_id = $1`,
    [quoteId],
  );

  // Box total (always stored)
  const boxes = await q<{ extended_price_usd: string | null }>(
    `SELECT extended_price_usd FROM public.quote_box_selections WHERE quote_id = $1`,
    [quoteId],
  );
  const boxTotal = boxes.reduce((s, b) => s + safeNum(b.extended_price_usd), 0);

  let foamTotal = 0;

  if (items.length === 0) {
    // PRE-APPLY: price from Redis facts — same as print route
    const facts = (await loadFacts(quoteNo)) || {};
    const dims = parseDims((facts as any).dims);
    const qty = safeNum((facts as any).qty);
    const materialId = safeNum((facts as any).material_id);
    if (dims && qty > 0 && materialId > 0) {
      foamTotal = await calcTotal(base, dims.L, dims.W, dims.H, qty, materialId);
    }
  } else {
    // POST-APPLY: price each non-excluded item
    const prices = await Promise.all(
      items
        .filter((it) => !isExcludedRow(it.notes))
        .map(async (it) => {
          if (it.price_total_usd !== null && safeNum(it.price_total_usd) > 0) {
            return safeNum(it.price_total_usd);
          }
          const L = Number(it.length_in), W = Number(it.width_in), H = Number(it.height_in);
          const qty = Number(it.qty), materialId = Number(it.material_id);
          if (![L, W, H].every((n) => Number.isFinite(n) && n > 0) || !(qty > 0) || !(materialId > 0)) return 0;
          return calcTotal(base, L, W, H, qty, materialId);
        }),
    );
    foamTotal = prices.reduce((s, p) => s + p, 0);
  }

  return Math.round((foamTotal + boxTotal) * 100) / 100;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);

    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const tenantId = user.tenant_id;

    await one(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT NULL`, []).catch(() => null);

    const reps = await q<{
      user_id: number; name: string; email: string;
      sales_slug: string; commission_pct: number | null;
    }>(
      `SELECT id AS user_id, name, email, sales_slug, commission_pct
       FROM public.users
       WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND sales_slug <> ''
       ORDER BY name ASC`,
      [tenantId],
    );

    if (!reps || reps.length === 0) return ok({ ok: true, rows: [] });

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const rows: CommissionRow[] = await Promise.all(
      reps.map(async (rep) => {
        const quotes = await q<{ id: number; quote_no: string }>(
          `SELECT id, quote_no FROM public.quotes WHERE sales_rep_id = $1 AND tenant_id = $2`,
          [rep.user_id, tenantId],
        );

        if (quotes.length === 0) {
          return { ...rep, quote_count: 0, quotes_total_usd: 0, commission_usd: 0 };
        }

        const quoteTotals = await Promise.all(
          quotes.map((q) => getQuoteTotal(q.id, q.quote_no, base)),
        );

        const quotesTotal = Math.round(quoteTotals.reduce((s, t) => s + t, 0) * 100) / 100;
        const pct = safeNum(rep.commission_pct);
        const commissionAmt = Math.round(quotesTotal * (pct / 100) * 100) / 100;

        return {
          user_id: rep.user_id,
          name: rep.name,
          email: rep.email,
          sales_slug: rep.sales_slug,
          commission_pct: rep.commission_pct,
          quote_count: quotes.length,
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