// app/api/admin/expenses/route.ts
//
// Live expense summary for every sales rep in the tenant -- the expense-side
// counterpart to /api/admin/commissions.
//
// "Outstanding" means not yet swept into a closed reimbursement period, i.e.
// what the next close would capture. All-time is shown alongside it so a rep
// row still reads sensibly once everything has been reimbursed.
//
// Every expense type counts here, including "misc" (Misc / Special Items) --
// one ledger, one number for an admin to reimburse.
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { ensureExpenseTables } from "@/app/lib/expense-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

export type ExpenseRepRow = {
  user_id: number; name: string; email: string; sales_slug: string;
  outstanding_count: number; outstanding_usd: number;
  all_time_count: number; all_time_usd: number;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);

    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureExpenseTables();

    const rows = await q<{
      user_id: number; name: string; email: string; sales_slug: string;
      outstanding_count: number; outstanding_usd: string;
      all_time_count: number; all_time_usd: string;
    }>(
      `SELECT u.id AS user_id, u.name, u.email, u.sales_slug,
              COUNT(e.id) FILTER (WHERE e.expense_payout_id IS NULL)::int AS outstanding_count,
              COALESCE(SUM(e.amount_usd) FILTER (WHERE e.expense_payout_id IS NULL), 0)::text AS outstanding_usd,
              COUNT(e.id)::int AS all_time_count,
              COALESCE(SUM(e.amount_usd), 0)::text AS all_time_usd
       FROM public.users u
       LEFT JOIN public.expenses e
         ON e.user_id = u.id AND e.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1 AND u.sales_slug IS NOT NULL AND u.sales_slug <> ''
       GROUP BY u.id, u.name, u.email, u.sales_slug
       ORDER BY u.name ASC`,
      [user.tenant_id],
    );

    const shaped: ExpenseRepRow[] = rows.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      email: r.email,
      sales_slug: r.sales_slug,
      outstanding_count: Number(r.outstanding_count),
      outstanding_usd: Number(r.outstanding_usd),
      all_time_count: Number(r.all_time_count),
      all_time_usd: Number(r.all_time_usd),
    }));

    shaped.sort((a, b) => b.outstanding_usd - a.outstanding_usd);
    return ok({ ok: true, rows: shaped });
  } catch (err: any) {
    console.error("admin expenses GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
