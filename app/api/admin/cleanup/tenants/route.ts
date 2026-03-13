// app/api/admin/cleanup/tenants/route.ts
//
// Data cleanup for tenant records.
// SUPER-OWNER ONLY (25thhourdesign@gmail.com).
//
// POST   /api/admin/cleanup/tenants  — dry-run: count + data volume preview
// DELETE /api/admin/cleanup/tenants  — cascade-delete tenant + all its data
//
// Safety: "default" tenant is always excluded.
// Safety: uses SAVEPOINTs for optional-table deletes.

import { NextRequest, NextResponse } from "next/server";
import { q, one, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

function isSuperOwner(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return email === "25thhourdesign@gmail.com";
}

interface TenantFilters {
  slug?: string;
  active?: boolean;
  before?: string;
  after?: string;
}

function buildWhere(filters: TenantFilters, startIdx = 1) {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = startIdx;

  // Always protect the default tenant
  conditions.push(`t.slug <> 'default'`);

  if (filters.slug) {
    conditions.push(`t.slug = $${idx++}`);
    values.push(filters.slug);
  }
  if (typeof filters.active === "boolean") {
    conditions.push(`t.active = $${idx++}`);
    values.push(filters.active);
  }
  if (filters.before) {
    conditions.push(`t.created_at < $${idx++}`);
    values.push(new Date(filters.before));
  }
  if (filters.after) {
    conditions.push(`t.created_at > $${idx++}`);
    values.push(new Date(filters.after));
  }

  return {
    where: `WHERE ${conditions.join(" AND ")}`,
    values,
  };
}

// POST — dry run
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isSuperOwner(user)) return bad({ ok: false, error: "forbidden — super-owner only" }, 403);

    const body = await req.json().catch(() => ({}));
    const filters: TenantFilters = {
      slug: body.slug || undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      before: body.before || undefined,
      after: body.after || undefined,
    };

    const { where, values } = buildWhere(filters);

    const tenantCount = await one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.tenants t ${where}`,
      values
    );

    const tenantRows = await q<{ id: number }>(
      `SELECT t.id FROM public.tenants t ${where}`,
      values
    );
    const ids = tenantRows.map((r) => r.id);

    let quoteCount = 0;
    let userCount = 0;
    if (ids.length > 0) {
      const idList = ids.join(",");
      const qc = await one<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.quotes WHERE tenant_id = ANY(ARRAY[${idList}]::int[])`
      );
      const uc = await one<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.users WHERE tenant_id = ANY(ARRAY[${idList}]::int[])`
      );
      quoteCount = parseInt(qc?.count || "0", 10);
      userCount = parseInt(uc?.count || "0", 10);
    }

    return ok({
      ok: true,
      dryRun: true,
      count: parseInt(tenantCount?.count || "0", 10),
      tenantIds: ids,
      quoteCount,
      userCount,
    });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

// DELETE — execute
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isSuperOwner(user)) return bad({ ok: false, error: "forbidden — super-owner only" }, 403);

    const body = await req.json().catch(() => ({}));
    const filters: TenantFilters = {
      slug: body.slug || undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      before: body.before || undefined,
      after: body.after || undefined,
    };

    const hasFilter = filters.slug || typeof filters.active === "boolean" || filters.before || filters.after;
    if (!hasFilter) {
      return bad({ ok: false, error: "At least one filter is required for tenant deletion." }, 400);
    }

    const { where, values } = buildWhere(filters);

    const deleted = await withTxn(async (tx) => {
      const rows = await tx.query<{ id: number; slug: string }>(
        `SELECT t.id, t.slug FROM public.tenants t ${where}`,
        values
      );
      const tenants = rows.rows;
      if (tenants.length === 0) return { count: 0, slugs: [] };

      const ids = tenants.map((r) => r.id);
      const slugs = tenants.map((r) => r.slug);
      const idList = ids.join(",");

      async function safeDelete(sql: string) {
        await tx.query(`SAVEPOINT before_optional`);
        try {
          await tx.query(sql);
          await tx.query(`RELEASE SAVEPOINT before_optional`);
        } catch {
          await tx.query(`ROLLBACK TO SAVEPOINT before_optional`);
          await tx.query(`RELEASE SAVEPOINT before_optional`);
        }
      }

      // Get quote IDs to cascade children
      const quoteRows = await tx.query<{ id: number }>(
        `SELECT id FROM public.quotes WHERE tenant_id = ANY(ARRAY[${idList}]::int[])`
      );
      const quoteIds = quoteRows.rows.map((r) => r.id);

      if (quoteIds.length > 0) {
        const qidList = quoteIds.join(",");
        await safeDelete(`DELETE FROM public.quote_layout_packages WHERE quote_id = ANY(ARRAY[${qidList}]::int[])`);
        await safeDelete(`DELETE FROM public.quote_line_items WHERE quote_id = ANY(ARRAY[${qidList}]::int[])`);
        await tx.query(`DELETE FROM public.quotes WHERE id = ANY(ARRAY[${qidList}]::int[])`);
      }

      await safeDelete(`DELETE FROM public.commission_payouts WHERE tenant_id = ANY(ARRAY[${idList}]::int[])`);
      await tx.query(`DELETE FROM public.users WHERE tenant_id = ANY(ARRAY[${idList}]::int[])`);
      await tx.query(`DELETE FROM public.tenants WHERE id = ANY(ARRAY[${idList}]::int[])`);

      // Audit log
      const detail = JSON.stringify({ filters, deleted: ids.length, slugs }).replace(/'/g, "''");
      const actorEmail = String(user.email || "").replace(/'/g, "''");
      await safeDelete(
        `INSERT INTO public.admin_audit_log (actor_user_id, actor_email, action, detail, created_at)
         VALUES (${Number(user.id)}, '${actorEmail}', 'cleanup_tenants', '${detail}'::jsonb, NOW())`
      );

      return { count: ids.length, slugs };
    });

    return ok({ ok: true, deleted: deleted.count, deletedSlugs: deleted.slugs });
  } catch (e: any) {
    return bad({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}
