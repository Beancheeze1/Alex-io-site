// app/lib/account-rep.ts
//
// Step 39O: account reps on customers (migration 051) and the commission
// rule for new quotes (app/lib/account-rep-core.ts). Every function is safe
// before migration 051 runs: it returns null / false / [] and changes nothing.

import { one, q } from "@/lib/db";
import type { RepOption } from "@/app/lib/account-rep-core";

let ready: boolean | null = null;

/** Migration 051 has run (both columns exist). Cached once true. */
export async function accountRepReady(): Promise<boolean> {
  if (ready) return true;
  try {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'customers' AND column_name = 'account_rep_id')
            OR (table_name = 'quotes' AND column_name = 'rep_set_by_staff'))`,
    );
    ready = Number(r?.n) === 2;
  } catch {
    ready = false;
  }
  return ready;
}

/** Staff of the shop who have a sales slug (they can be credited). */
export async function listReps(tenantId: number): Promise<RepOption[]> {
  try {
    const rows = await q<{ id: number; name: string | null; email: string | null; role: string | null; sales_slug: string }>(
      `SELECT id, name, email, role, sales_slug FROM public."users"
        WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND btrim(sales_slug) <> ''
          AND lower(coalesce(role, '')) IN ('admin', 'cs', 'sales')
        ORDER BY lower(coalesce(name, email, sales_slug))`,
      [tenantId],
    );
    return rows.map((r) => ({ id: Number(r.id), name: (r.name || r.email || r.sales_slug).trim(), role: String(r.role || "").toLowerCase(), slug: r.sales_slug }));
  } catch {
    return [];
  }
}

/** The customer's account rep id (null when none, or before migration 051). */
export async function customerAccountRepId(tenantId: number, customerId: number | null | undefined): Promise<number | null> {
  if (!customerId || !(await accountRepReady())) return null;
  try {
    const r = await one<{ account_rep_id: number | null }>(
      // a removed user no longer counts
      `SELECT c.account_rep_id FROM public.customers c
         JOIN public."users" u ON u.id = c.account_rep_id AND u.tenant_id = c.tenant_id
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [customerId, tenantId],
    );
    return r?.account_rep_id ? Number(r.account_rep_id) : null;
  } catch {
    return null;
  }
}

/** The customer for an email (tenant-scoped) and their account rep id. */
export async function accountRepForEmail(tenantId: number, email: string): Promise<{ customer_id: number; account_rep_id: number | null } | null> {
  const e = email.trim().toLowerCase();
  if (!e || !(await accountRepReady())) return null;
  try {
    const r = await one<{ id: number; account_rep_id: number | null }>(
      `SELECT c.id, u.id AS account_rep_id FROM public.customers c
         LEFT JOIN public."users" u ON u.id = c.account_rep_id AND u.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND lower(c.email) = $2 LIMIT 1`,
      [tenantId, e],
    );
    return r ? { customer_id: Number(r.id), account_rep_id: r.account_rep_id ? Number(r.account_rep_id) : null } : null;
  } catch {
    return null;
  }
}

/**
 * A quote with no rep yet gets its customer's account rep, unless staff
 * chose the rep on the form (rep_set_by_staff) or it's released. Returns
 * the rep id set, else null.
 */
export async function fillAccountRep(quoteId: number, tenantId: number): Promise<number | null> {
  if (!(await accountRepReady())) return null;
  try {
    const r = await one<{ sales_rep_id: number }>(
      `UPDATE public."quotes" qq
          SET sales_rep_id = c.account_rep_id
         FROM public.customers c
        WHERE qq.id = $1 AND qq.tenant_id = $2
          AND qq.sales_rep_id IS NULL
          AND qq.rep_set_by_staff = false
          AND coalesce(qq.locked, false) = false
          AND c.id = qq.customer_id AND c.tenant_id = qq.tenant_id
          AND c.account_rep_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public."users" u WHERE u.id = c.account_rep_id AND u.tenant_id = qq.tenant_id)
       RETURNING qq.sales_rep_id`,
      [quoteId, tenantId],
    );
    return r?.sales_rep_id ? Number(r.sales_rep_id) : null;
  } catch (e) {
    console.warn("[account-rep] fill skipped", { quoteId, err: String(e) });
    return null;
  }
}

/** Staff chose the rep (or "No commission") for this quote: never auto-fill it. */
export async function markRepSetByStaff(quoteId: number, tenantId: number): Promise<void> {
  if (!(await accountRepReady())) return;
  try {
    await q(`UPDATE public."quotes" SET rep_set_by_staff = true WHERE id = $1 AND tenant_id = $2`, [quoteId, tenantId]);
  } catch (e) {
    console.warn("[account-rep] mark skipped", { quoteId, err: String(e) });
  }
}
