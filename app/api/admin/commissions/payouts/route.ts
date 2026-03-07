// app/api/admin/commissions/payouts/route.ts
//
// Manages monthly commission payout snapshots.
//
// GET  — list all payout records for this tenant
// POST — "close month": snapshot current RFM totals into commission_payouts
// PATCH — mark a payout as paid (stamps paid_at)
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { loadFacts } from "@/app/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

// ── DB bootstrap ─────────────────────────────────────────────────────────────

async function ensureTables() {
  await one(
    `CREATE TABLE IF NOT EXISTS public.commission_payouts (
      id              serial PRIMARY KEY,
      tenant_id       integer NOT NULL,
      user_id         integer NOT NULL,
      period          char(7) NOT NULL,        -- 'YYYY-MM'
      quotes_total_usd numeric(10,2) NOT NULL DEFAULT 0,
      commission_pct   numeric(5,2)  NOT NULL DEFAULT 0,
      commission_usd   numeric(10,2) NOT NULL DEFAULT 0,
      quote_count      integer       NOT NULL DEFAULT 0,
      paid_at          timestamptz   DEFAULT NULL,
      paid_by_user_id  integer       DEFAULT NULL,
      notes            text          DEFAULT NULL,
      created_at       timestamptz   NOT NULL DEFAULT NOW(),
      updated_at       timestamptz   NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, user_id, period)
    )`,
    [],
  ).catch(() => null);

  await one(
    `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT NULL`,
    [],
  ).catch(() => null);
}

// ── Pricing helpers (mirrors commissions/route.ts) ───────────────────────────

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDims(dims: any): { L: number; W: number; H: number } | null {
  if (!dims) return null;
  if (typeof dims === "object") {
    const L = Number(dims.L), W = Number(dims.W), H = Number(dims.H);
    return [L, W, H].every((n) => Number.isFinite(n) && n > 0) ? { L, W, H } : null;
  }
  const [L, W, H] = String(dims).split("x").map((s) => Number(s.trim()));
  return [L, W, H].every((n) => Number.isFinite(n) && n > 0) ? { L, W, H } : null;
}

function isExcluded(notes: string | null): boolean {
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

async function getQuoteTotal(quoteId: number, quoteNo: string, base: string): Promise<number> {
  const items = await q<{
    length_in: string; width_in: string; height_in: string;
    qty: number; material_id: number; price_total_usd: string | null; notes: string | null;
  }>(`SELECT length_in, width_in, height_in, qty, material_id, price_total_usd, notes
      FROM public.quote_items WHERE quote_id = $1`, [quoteId]);

  const boxes = await q<{ extended_price_usd: string | null }>(
    `SELECT extended_price_usd FROM public.quote_box_selections WHERE quote_id = $1`, [quoteId]);
  const boxTotal = boxes.reduce((s, b) => s + safeNum(b.extended_price_usd), 0);

  let foamTotal = 0;
  if (items.length === 0) {
    const facts = (await loadFacts(quoteNo)) || {};
    const dims = parseDims((facts as any).dims);
    const qty = safeNum((facts as any).qty);
    const materialId = safeNum((facts as any).material_id);
    if (dims && qty > 0 && materialId > 0) {
      foamTotal = await calcTotal(base, dims.L, dims.W, dims.H, qty, materialId);
    }
  } else {
    const prices = await Promise.all(
      items.filter((it) => !isExcluded(it.notes)).map(async (it) => {
        if (it.price_total_usd !== null && safeNum(it.price_total_usd) > 0) return safeNum(it.price_total_usd);
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

// ── GET: list all payouts ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureTables();

    const payouts = await q<{
      id: number; user_id: number; name: string; email: string;
      sales_slug: string; period: string;
      quotes_total_usd: string; commission_pct: string; commission_usd: string;
      quote_count: number; paid_at: string | null; paid_by_name: string | null;
      notes: string | null; created_at: string;
    }>(
      `SELECT cp.id, cp.user_id, u.name, u.email, u.sales_slug,
              cp.period, cp.quotes_total_usd, cp.commission_pct, cp.commission_usd,
              cp.quote_count, cp.paid_at, pb.name AS paid_by_name,
              cp.notes, cp.created_at
       FROM public.commission_payouts cp
       JOIN public.users u  ON u.id = cp.user_id
       LEFT JOIN public.users pb ON pb.id = cp.paid_by_user_id
       WHERE cp.tenant_id = $1
       ORDER BY cp.period DESC, u.name ASC`,
      [user.tenant_id],
    );

    return ok({ ok: true, payouts });
  } catch (err: any) {
    console.error("payouts GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

// ── POST: close a month (snapshot current RFM totals) ────────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const period: string = body?.period; // e.g. '2026-03'
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return bad({ ok: false, error: "invalid_period", message: "Expected period in YYYY-MM format." });
    }

    await ensureTables();

    const tenantId = user.tenant_id;
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    // Get all reps with a slug
    const reps = await q<{ user_id: number; name: string; commission_pct: number | null }>(
      `SELECT id AS user_id, name, commission_pct
       FROM public.users
       WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND sales_slug <> ''`,
      [tenantId],
    );

    const [year, month] = period.split("-").map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 1); // exclusive

    const results = await Promise.all(reps.map(async (rep) => {
      // Only RFM (locked=true) quotes created in this period
      const quotes = await q<{ id: number; quote_no: string }>(
        `SELECT id, quote_no FROM public.quotes
         WHERE sales_rep_id = $1 AND tenant_id = $2
           AND locked = true
           AND created_at >= $3 AND created_at < $4`,
        [rep.user_id, tenantId, periodStart.toISOString(), periodEnd.toISOString()],
      );

      const totals = await Promise.all(quotes.map((qt) => getQuoteTotal(qt.id, qt.quote_no, base)));
      const quotesTotal = Math.round(totals.reduce((s, t) => s + t, 0) * 100) / 100;
      const pct = safeNum(rep.commission_pct);
      const commissionAmt = Math.round(quotesTotal * (pct / 100) * 100) / 100;

      // Upsert — if period already closed, update the snapshot
      await one(
        `INSERT INTO public.commission_payouts
           (tenant_id, user_id, period, quotes_total_usd, commission_pct, commission_usd, quote_count, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (tenant_id, user_id, period) DO UPDATE
           SET quotes_total_usd = EXCLUDED.quotes_total_usd,
               commission_pct   = EXCLUDED.commission_pct,
               commission_usd   = EXCLUDED.commission_usd,
               quote_count      = EXCLUDED.quote_count,
               updated_at       = NOW()
           WHERE commission_payouts.paid_at IS NULL`,  // don't overwrite already-paid rows
        [tenantId, rep.user_id, period, quotesTotal, pct, commissionAmt, quotes.length],
      );

      return { user_id: rep.user_id, name: rep.name, period, quotes_total_usd: quotesTotal, commission_usd: commissionAmt };
    }));

    return ok({ ok: true, period, results });
  } catch (err: any) {
    console.error("payouts POST error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

// ── PATCH: mark a payout as paid ─────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const unpay = body?.unpay === true; // allow toggling back to unpaid

    if (!Number.isFinite(id) || id <= 0) {
      return bad({ ok: false, error: "invalid_id", message: "Expected { id }" });
    }

    await ensureTables();

    const updated = await one<{ id: number; paid_at: string | null }>(
      `UPDATE public.commission_payouts
       SET paid_at         = ${unpay ? "NULL" : "NOW()"},
           paid_by_user_id = ${unpay ? "NULL" : "$2"},
           updated_at      = NOW()
       WHERE id = $1 AND tenant_id = ${unpay ? "$2" : "$3"}
       RETURNING id, paid_at`,
      unpay ? [id, user.tenant_id] : [id, user.id, user.tenant_id],
    );

    if (!updated?.id) return bad({ ok: false, error: "not_found" }, 404);

    return ok({ ok: true, id: updated.id, paid_at: updated.paid_at });
  } catch (err: any) {
    console.error("payouts PATCH error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
