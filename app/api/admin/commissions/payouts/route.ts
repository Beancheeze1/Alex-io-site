// app/api/admin/commissions/payouts/route.ts
//
// Manages monthly commission payout snapshots.
//
// GET  — list all payout records for this tenant
// POST — "close month": sweep every locked (RFM) quote not yet linked to a
//        prior closed period into commission_payouts. Sweeping is done by
//        app/lib/period-close.ts's shared sweepPeriod() primitive -- see
//        that file for why: a close must NEVER filter by created_at
//        falling inside the selected calendar month (that let a quote from
//        a month nobody explicitly closed get orphaned forever). A period
//        represents "everything outstanding as of now", not a fixed date
//        range.
// PATCH — mark a payout as paid (stamps paid_at) or unpaid (unpay: true)
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { getCommissionableTotal, safeNum } from "@/app/lib/commission-pricing";
import { sweepPeriod, type SweepConfig } from "@/app/lib/period-close";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

async function ensureTables() {
  await one(
    `CREATE TABLE IF NOT EXISTS public.commission_payouts (
      id              serial PRIMARY KEY,
      tenant_id       integer NOT NULL,
      user_id         integer NOT NULL,
      period          char(7) NOT NULL,
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

  // migrations/020_commission_payout_quote_link.sql is the durable
  // definition; this is the same belt-and-braces ensureTables() already
  // does for the rest of this schema, so it works on an environment that
  // has not run migrations yet.
  await one(
    `ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS commission_payout_id integer DEFAULT NULL`,
    [],
  ).catch(() => null);

  await one(
    `CREATE INDEX IF NOT EXISTS quotes_commission_payout_idx
       ON public.quotes (tenant_id, sales_rep_id, commission_payout_id)`,
    [],
  ).catch(() => null);
}

const QUOTE_SWEEP_CONFIG: SweepConfig = {
  payoutTable: "public.commission_payouts",
  sourceTable: "public.quotes",
  sourceRepColumn: "sales_rep_id",
  linkColumn: "commission_payout_id",
  sourceExtraWhere: "AND locked = true",
  sourceSelectColumns: "id, quote_no",
};

type SweptQuote = { id: number; quote_no: string };

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

// ── POST: close a month ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const period: string = body?.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return bad({ ok: false, error: "invalid_period", message: "Expected period in YYYY-MM format." });
    }

    await ensureTables();

    const tenantId = user.tenant_id;
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const reps = await q<{ user_id: number; name: string; commission_pct: number | null }>(
      `SELECT id AS user_id, name, commission_pct
       FROM public.users
       WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND sales_slug <> ''`,
      [tenantId],
    );

    const results = await Promise.all(reps.map(async (rep) => {
      // Sweep: locks/creates the payout row and links every locked quote
      // for this rep not yet linked to ANY prior period -- never filtered
      // by created_at. See app/lib/period-close.ts.
      const sweep = await sweepPeriod<SweptQuote>(QUOTE_SWEEP_CONFIG, tenantId, rep.user_id, period);

      if (sweep.status === "already_paid") {
        const frozen = await one<{
          quotes_total_usd: string; commission_usd: string; quote_count: number;
        }>(
          `SELECT quotes_total_usd, commission_usd, quote_count
           FROM public.commission_payouts WHERE id = $1`,
          [sweep.payoutId],
        );
        return {
          user_id: rep.user_id, name: rep.name, period, status: sweep.status,
          quotes_total_usd: Number(frozen?.quotes_total_usd ?? 0),
          commission_usd: Number(frozen?.commission_usd ?? 0),
          quote_count: Number(frozen?.quote_count ?? 0),
          swept: 0,
        };
      }

      if (sweep.status === "skipped_empty") {
        return {
          user_id: rep.user_id, name: rep.name, period, status: sweep.status,
          quotes_total_usd: 0, commission_usd: 0, quote_count: 0, swept: 0,
        };
      }

      // Pricing is external (quote_items/box lookups + an HTTP round trip
      // to /api/quotes/calc) and re-derived from EVERY quote currently
      // linked to this payout -- not just what THIS call swept -- so
      // re-closing an unpaid period after new RFM activity recomputes the
      // whole period instead of drifting from an accumulated delta.
      const totals = await Promise.all(
        sweep.allLinkedRows.map((qt) => getCommissionableTotal(qt.id, qt.quote_no, base, tenantId)),
      );
      const quotesTotal = Math.round(totals.reduce((s, t) => s + t, 0) * 100) / 100;
      const pct = safeNum(rep.commission_pct);
      const commissionAmt = Math.round(quotesTotal * (pct / 100) * 100) / 100;

      await one(
        `UPDATE public.commission_payouts
         SET quotes_total_usd = $1, commission_pct = $2, commission_usd = $3,
             quote_count = $4, updated_at = NOW()
         WHERE id = $5 AND paid_at IS NULL`,
        [quotesTotal, pct, commissionAmt, sweep.allLinkedRows.length, sweep.payoutId],
      );

      return {
        user_id: rep.user_id, name: rep.name, period, status: sweep.status,
        quotes_total_usd: quotesTotal, commission_usd: commissionAmt,
        quote_count: sweep.allLinkedRows.length, swept: sweep.sweptRows.length,
      };
    }));

    return ok({ ok: true, period, results });
  } catch (err: any) {
    console.error("payouts POST error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

// ── PATCH: mark paid / unpaid ─────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const unpay = body?.unpay === true;

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
