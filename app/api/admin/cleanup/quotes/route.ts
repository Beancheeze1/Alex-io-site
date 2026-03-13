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
//
// Safety: locked (RFM) quotes are ALWAYS excluded.
// Safety: uses SAVEPOINTs for optional-table deletes to avoid transaction abort.

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

  // Always exclude locked (RFM) quotes
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
      // Collect matching quote IDs first
      const rows = await tx.query<{ id: number }>(
        `SELECT q.id FROM public.quotes q ${where}`,
        values
      );
      const ids = rows.rows.map((r) => r.id);
      if (ids.length === 0) return 0;

      const idList = ids.join(",");

      // Use SAVEPOINTs for optional-table deletes.
      // A plain .catch() on tx.query() swallows the JS error but leaves the
      // Postgres transaction in an aborted state — all subsequent queries fail.
      // SAVEPOINT lets us roll back just that statement cleanly.
      async function safeDelete(tableSql: string) {
        await tx.query(`SAVEPOINT before_optional`);
        try {
          await tx.query(tableSql);
          await tx.query(`RELEASE SAVEPOINT before_optional`);
        } catch {
          await tx.query(`ROLLBACK TO SAVEPOINT before_optional`);
          await tx.query(`RELEASE SAVEPOINT before_optional`);
        }
      }

      // Delete child rows (optional tables — use safeDelete)
      await safeDelete(`DELETE FROM public.quote_layout_packages WHERE quote_id = ANY(ARRAY[${idList}]::int[])`);
      await safeDelete(`DELETE FROM public.quote_line_items WHERE quote_id = ANY(ARRAY[${idList}]::int[])`);

      // Core delete — must succeed
      await tx.query(`DELETE FROM public.quotes WHERE id = ANY(ARRAY[${idList}]::int[])`);

      // Audit log (optional table)
      const detail = JSON.stringify({ filters, deleted: ids.length }).replace(/'/g, "''");
      const actorEmail = String(user.email || "").replace(/'/g, "''");
      await safeDelete(
        `INSERT INTO public.admin_audit_log (actor_user_id, actor_email, action, detail, created_at)
         VALUES (${Number(user.id)}, '${actorEmail}', 'cleanup_quotes', '${detail}'::jsonb, NOW())`
      );

      return ids.length;
    });

    return ok({ ok: true, deleted });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}
