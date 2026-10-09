// lib/admin-alerts.ts
//
// In-app admin alerts (Step 7). addAdminAlert() records one alert for a
// shop's staff. It NEVER throws — a failed alert must not break the route
// that called it.
//
// Skips: staff callers (when `req` is passed), demo quote numbers, and
// anything it can't tie to a shop. "buyer_change" and "artwork" alerts for
// the same quote within 10 minutes merge into the newest unread one.

import type { NextRequest } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isDemoQuoteNo } from "@/lib/quote-no";

export type AdminAlertKind = "new_quote" | "artwork" | "buyer_change" | "spec_request";

const MERGE_KINDS = new Set<AdminAlertKind>(["artwork", "buyer_change"]);

export async function addAdminAlert(a: {
  req?: NextRequest;
  tenantId?: number | null;
  quoteNo?: string | null;
  kind: AdminAlertKind;
  title: string;
  detail?: string | null;
  link?: string | null;
}): Promise<void> {
  try {
    if (a.req) {
      try {
        const user = await getCurrentUserFromRequest(a.req);
        if (user && isRoleAllowed(user, ["admin", "cs", "sales"])) return;
      } catch {
        // not logged in -> buyer
      }
    }

    const quoteNo = a.quoteNo ? String(a.quoteNo).trim().slice(0, 40) : null;
    if (quoteNo && isDemoQuoteNo(quoteNo)) return;

    let tenantId =
      a.tenantId != null && Number.isFinite(Number(a.tenantId)) ? Number(a.tenantId) : null;
    if (tenantId == null && quoteNo) {
      const row = await one<{ tenant_id: number | null }>(
        `SELECT tenant_id FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
        [quoteNo],
      );
      tenantId = row?.tenant_id != null ? Number(row.tenant_id) : null;
    }
    if (tenantId == null) return;

    const title = String(a.title || "").slice(0, 200) || "Alert";
    const detail = a.detail ? String(a.detail).slice(0, 1000) : null;
    const link =
      a.link !== undefined && a.link !== null
        ? String(a.link).slice(0, 300)
        : quoteNo
          ? `/admin/quotes/${encodeURIComponent(quoteNo)}`
          : null;

    if (quoteNo && MERGE_KINDS.has(a.kind)) {
      const merged = await one<{ id: number }>(
        `UPDATE public.admin_alerts
            SET title = $4, detail = $5, created_at = now()
          WHERE id = (
            SELECT id FROM public.admin_alerts
             WHERE tenant_id = $1 AND kind = $2 AND quote_no = $3
               AND read_at IS NULL
               AND created_at > now() - interval '10 minutes'
             ORDER BY created_at DESC
             LIMIT 1
          )
          RETURNING id`,
        [tenantId, a.kind, quoteNo, title, detail],
      );
      if (merged) return;
    }

    await q(
      `INSERT INTO public.admin_alerts (tenant_id, kind, quote_no, title, detail, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, a.kind, quoteNo, title, detail, link],
    );
  } catch (e) {
    console.warn("[admin-alerts] skipped:", String(e));
  }
}
