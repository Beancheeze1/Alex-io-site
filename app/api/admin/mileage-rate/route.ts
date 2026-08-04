// app/api/admin/mileage-rate/route.ts
//
// Tenant-wide mileage reimbursement rate ($/mile), used by the rep-facing
// expense tracker on /admin/quotes to auto-calculate a dollar amount from
// miles driven -- mirrors commission_pct in spirit (a durable, tenant-scoped
// numeric knob), but lives on `tenants` since it's one rate for the whole
// business, not per-user.
//
// GET   — any authenticated user in the tenant (reps need it to preview the
//         calculated $ amount before submitting an expense).
// PATCH — admin-only.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fallback used until an admin explicitly sets a rate for their tenant.
export const DEFAULT_MILEAGE_RATE_USD = 0.67;

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

async function ensureColumn() {
  await one(
    `ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS mileage_rate_usd numeric(6,3) DEFAULT NULL`,
    [],
  ).catch(() => null);
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureColumn();

    const row = await one<{ mileage_rate_usd: string | null }>(
      `SELECT mileage_rate_usd FROM public.tenants WHERE id = $1`,
      [user.tenant_id],
    );

    const rate = row?.mileage_rate_usd != null ? Number(row.mileage_rate_usd) : DEFAULT_MILEAGE_RATE_USD;
    return ok({ ok: true, mileage_rate_usd: rate });
  } catch (err: any) {
    console.error("mileage-rate GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const rate = Number(body?.mileage_rate_usd);
    if (!Number.isFinite(rate) || rate < 0 || rate > 10) {
      return bad({ ok: false, error: "invalid_rate", message: "Rate must be a number between 0 and 10." });
    }

    await ensureColumn();

    await one(
      `UPDATE public.tenants SET mileage_rate_usd = $1 WHERE id = $2`,
      [rate, user.tenant_id],
    );

    return ok({ ok: true, mileage_rate_usd: rate });
  } catch (err: any) {
    console.error("mileage-rate PATCH error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
