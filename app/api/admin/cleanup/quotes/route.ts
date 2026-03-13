// app/api/admin/cleanup/quotes/route.ts
//
// Data cleanup for quotes + associated child rows.
// Only accessible to admin role users.
//
// POST  /api/admin/cleanup/quotes  — dry-run: returns count of matching quotes
// DELETE /api/admin/cleanup/quotes — execute: deletes matching quotes + children
//
// Filters (all optional, at least one required for DELETE):
//   tenantId  — restrict to a specific tenant
//   status    — "draft" | "sent" | "rfm" | etc.
//   before    — ISO date string, delete quotes created before this date
//   after     — ISO date string, delete quotes created after this date

import { NextRequest, NextResponse } from "next/server";
import { q, one, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

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

interface CleanupFilters {
  tenantId?: number;
  status?: string;
  before?: string;
  after?: string;
}

function buildWhere(filters: CleanupFilters, startIdx = 1) {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = startIdx;

  if (filters.tenantId) {
    conditions.push(`q.tenant_id = $${idx++}`);
    values.push(filters.tenantId);
  }
  if (filters.status) {
    conditions.push(`q.status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.before) {
    conditions.push(`q.created_at < $${idx++}`);
    values.push(new Date(filters.before));
  }
  if (filters.after) {
    conditions.push(`q.created_at > $${idx++}`);
    values.push(new Date(filters.after));
  }

  // Never delete locked (RFM) quotes — safety guard
  conditions.push(`(q.locked IS NULL OR q.locked = false)`);

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "WHERE (q.locked IS NULL OR q.locked = false)",
    values,
  };
}

// POST — dry run, returns count
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isAdminUser(user)) return bad({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const filters: CleanupFilters = {
      tenantId: body.tenantId ? Number(body.tenantId) : undefined,
      status: body.status || undefined,
      before: body.before || undefined,
      after: body.after || undefined,
    };

    // Non-super-owners can only query their own tenant
    if (!isSuperOwner(user)) {
      filters.tenantId = user.tenant_id;
    }

    const { where, values } = buildWhere(filters);
    const result = await one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.quotes q ${where}`,
      values
    );

    return ok({ ok: true, count: parseInt(result?.count || "0", 10), dryRun: true });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

// DELETE — execute deletion
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isAdminUser(user)) return bad({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const filters: CleanupFilters = {
      tenantId: body.tenantId ? Number(body.tenantId) : undefined,
      status: body.status || undefined,
      before: body.before || undefined,
      after: body.after || undefined,
    };

    if (!isSuperOwner(user)) {
      filters.tenantId = user.tenant_id;
    }

    // Require at least one real filter beyond the locked guard
    const hasFilter = filters.tenantId || filters.status || filters.before || filters.after;
    if (!hasFilter) {
      return bad({ ok: false, error: "At least one filter is required for deletion." }, 400);
    }

    const { where, values } = buildWhere(filters);

    const deleted = await withTxn(async (tx) => {
      // Collect IDs first
      const rows = await tx.query<{ id: number }>(
        `SELECT q.id FROM public.quotes q ${where}`,
        values
      );
      const ids = rows.rows.map((r) => r.id);
      if (ids.length === 0) return 0;

      const idList = ids.join(",");

      // Delete children in dependency order
      await tx.query(`DELETE FROM public.quote_layout_packages WHERE quote_id = ANY(ARRAY[${idList}]::int[])`);
      await tx.query(`DELETE FROM public.quote_line_items WHERE quote_id = ANY(ARRAY[${idList}]::int[])`)
        .catch(() => null); // table may not exist in all versions
      await tx.query(`DELETE FROM public.quotes WHERE id = ANY(ARRAY[${idList}]::int[])`);

      // Write audit log
      await tx.query(
        `INSERT INTO public.admin_audit_log (actor_user_id, actor_email, action, detail, created_at)
         VALUES ($1, $2, 'cleanup_quotes', $3, NOW())
         ON CONFLICT DO NOTHING`,
        [
          user.id,
          user.email,
          JSON.stringify({ filters, deleted: ids.length, ids: ids.slice(0, 50) }),
        ]
      ).catch(() => null); // table may not exist yet — non-fatal

      return ids.length;
    });

    return ok({ ok: true, deleted });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}
