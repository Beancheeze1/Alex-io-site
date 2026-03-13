// app/api/admin/cleanup/users/route.ts
//
// Data cleanup for sales rep / user records.
// Only accessible to admin role users.
//
// POST   /api/admin/cleanup/users  — dry-run: returns count of matching users
// DELETE /api/admin/cleanup/users  — execute: deletes matching users
//
// Filters (all optional, at least one required for DELETE):
//   tenantId   — restrict to a specific tenant (super-owner only)
//   role       — "sales" | "cs" | "admin"
//   before     — ISO date string, created before
//   after      — ISO date string, created after
//   hasNoQuotes — boolean, only users with zero quotes
//
// Safety: will never delete a user who has locked (RFM) quotes.
// Safety: will never delete the requesting user themselves.

import { NextRequest, NextResponse } from "next/server";
import { q, one, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

function isAdminUser(user: any): boolean {
  return String(user?.role || "").trim().toLowerCase() === "admin";
}

function isSuperOwner(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return email === "25thhourdesign@gmail.com";
}

interface UserFilters {
  tenantId?: number;
  role?: string;
  before?: string;
  after?: string;
  hasNoQuotes?: boolean;
}

function buildWhere(filters: UserFilters, excludeUserId: number, startIdx = 1) {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = startIdx;

  if (filters.tenantId) {
    conditions.push(`u.tenant_id = $${idx++}`);
    values.push(filters.tenantId);
  }
  if (filters.role) {
    conditions.push(`u.role = $${idx++}`);
    values.push(filters.role);
  }
  if (filters.before) {
    conditions.push(`u.created_at < $${idx++}`);
    values.push(new Date(filters.before));
  }
  if (filters.after) {
    conditions.push(`u.created_at > $${idx++}`);
    values.push(new Date(filters.after));
  }
  if (filters.hasNoQuotes) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.sales_rep_id = u.id)`);
  }

  // Never delete the requesting user
  conditions.push(`u.id <> $${idx++}`);
  values.push(excludeUserId);

  // Never delete users with locked quotes
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM public.quotes lq
    WHERE lq.sales_rep_id = u.id AND lq.locked = true
  )`);

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

// POST — dry run
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isAdminUser(user)) return bad({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const filters: UserFilters = {
      tenantId: body.tenantId ? Number(body.tenantId) : undefined,
      role: body.role || undefined,
      before: body.before || undefined,
      after: body.after || undefined,
      hasNoQuotes: !!body.hasNoQuotes,
    };

    if (!isSuperOwner(user)) {
      filters.tenantId = user.tenant_id;
    }

    const { where, values } = buildWhere(filters, user.id);
    const result = await one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.users u ${where}`,
      values
    );

    return ok({ ok: true, count: parseInt(result?.count || "0", 10), dryRun: true });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

// DELETE — execute
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isAdminUser(user)) return bad({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const filters: UserFilters = {
      tenantId: body.tenantId ? Number(body.tenantId) : undefined,
      role: body.role || undefined,
      before: body.before || undefined,
      after: body.after || undefined,
      hasNoQuotes: !!body.hasNoQuotes,
    };

    if (!isSuperOwner(user)) {
      filters.tenantId = user.tenant_id;
    }

    const hasFilter = filters.tenantId || filters.role || filters.before || filters.after || filters.hasNoQuotes;
    if (!hasFilter) {
      return bad({ ok: false, error: "At least one filter is required for deletion." }, 400);
    }

    const { where, values } = buildWhere(filters, user.id);

    const deleted = await withTxn(async (tx) => {
      const rows = await tx.query<{ id: number }>(
        `SELECT u.id FROM public.users u ${where}`,
        values
      );
      const ids = rows.rows.map((r) => r.id);
      if (ids.length === 0) return 0;

      const idList = ids.join(",");

      // Null-out sales_rep_id on quotes (don't delete the quotes themselves)
      await tx.query(
        `UPDATE public.quotes SET sales_rep_id = NULL WHERE sales_rep_id = ANY(ARRAY[${idList}]::int[])`
      );

      // Delete commission payouts
      await tx.query(
        `DELETE FROM public.commission_payouts WHERE user_id = ANY(ARRAY[${idList}]::int[])`
      ).catch(() => null);

      await tx.query(`DELETE FROM public.users WHERE id = ANY(ARRAY[${idList}]::int[])`);

      // Audit log
      await tx.query(
        `INSERT INTO public.admin_audit_log (actor_user_id, actor_email, action, detail, created_at)
         VALUES ($1, $2, 'cleanup_users', $3, NOW())
         ON CONFLICT DO NOTHING`,
        [
          user.id,
          user.email,
          JSON.stringify({ filters, deleted: ids.length }),
        ]
      ).catch(() => null);

      return ids.length;
    });

    return ok({ ok: true, deleted });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}
