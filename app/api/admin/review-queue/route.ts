// app/api/admin/review-queue/route.ts
//
// Step 32: the staff review queue for the caller's shop.
//   GET  ?mine=1&snoozed=1&count=1
//     -> { ok, sections: { new, to_confirm, reapprove, proofs, needs_review },
//          counts, snoozed (hidden by the filter), staff: [{ id, name }], me }
//     count=1 returns only { ok, counts } (the menu badge).
//   POST { quote_no, action: "assign", user_id: number | null }
//        { quote_no, action: "snooze", until: "tomorrow" | "3d" | "1w" | "YYYY-MM-DD" | null }
//     -> { ok }
// Staff (admin / cs / sales) of the shop.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { buildQueue, clearQueueCache } from "@/app/lib/review-queue";
import { groupBySection, isSnoozed, sectionCounts, snoozeUntil, visibleItems } from "@/app/lib/review-queue-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

async function staff(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: bad("unauthorized", "Login required.", 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: bad("forbidden", "Staff only.", 403) };
  const tenantId = Number(user.tenant_id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { res: bad("no_tenant", "Your account has no shop.", 400) };
  return { user, tenantId };
}

export async function GET(req: NextRequest) {
  try {
    const s = await staff(req);
    if ("res" in s) return s.res;
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const all = await buildQueue(s.tenantId, { fresh: sp.get("fresh") === "1" });
    const shown = visibleItems(all, {
      now,
      showSnoozed: sp.get("snoozed") === "1",
      mineUserId: sp.get("mine") === "1" ? Number(s.user.id) : null,
    });
    if (sp.get("count") === "1") return json({ ok: true, counts: sectionCounts(visibleItems(all, { now })) });
    const staffList = await q<{ id: number; name: string | null; email: string | null }>(
      `SELECT id, name, email FROM public."users"
        WHERE tenant_id = $1 AND lower(role) IN ('admin', 'cs', 'sales')
        ORDER BY name NULLS LAST, id`,
      [s.tenantId],
    ).catch(() => []);
    return json({
      ok: true,
      sections: groupBySection(shown),
      counts: sectionCounts(shown),
      // how many snoozed items the current filter hides
      snoozed: all.filter((i) => isSnoozed(i, now) && (sp.get("mine") !== "1" || i.assigned_user_id === Number(s.user.id))).length,
      staff: staffList.map((u) => ({ id: Number(u.id), name: u.name || u.email || `User ${u.id}` })),
      me: Number(s.user.id),
    });
  } catch (e) {
    console.error("[admin/review-queue] GET failed:", e);
    return bad("server_error", "Couldn't load the review queue.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const s = await staff(req);
    if ("res" in s) return s.res;
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const quote = await one<{ id: number }>(
      `SELECT id FROM public.quotes WHERE quote_no = $1 AND tenant_id = $2 LIMIT 1`,
      [quoteNo, s.tenantId],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);
    const who = String((s.user as { name?: string | null }).name || s.user.email || "staff").slice(0, 120);

    if (b?.action === "assign") {
      let userId: number | null = null;
      let name: string | null = null;
      if (b.user_id !== null && b.user_id !== undefined && b.user_id !== "") {
        const u = await one<{ id: number; name: string | null; email: string | null }>(
          `SELECT id, name, email FROM public."users"
            WHERE id = $1 AND tenant_id = $2 AND lower(role) IN ('admin', 'cs', 'sales')`,
          [Number(b.user_id), s.tenantId],
        );
        if (!u) return bad("invalid_user", "Pick someone from your shop.");
        userId = Number(u.id);
        name = u.name || u.email || null;
      }
      await q(
        `INSERT INTO public.quote_queue_state (quote_id, tenant_id, assigned_user_id, assigned_name, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (quote_id) DO UPDATE
           SET assigned_user_id = EXCLUDED.assigned_user_id, assigned_name = EXCLUDED.assigned_name,
               updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [quote.id, s.tenantId, userId, name, who],
      );
    } else if (b?.action === "snooze") {
      const until = snoozeUntil(b.until, new Date());
      if (until === undefined) return bad("invalid_until", "Pick when to bring it back (a future date).");
      await q(
        `INSERT INTO public.quote_queue_state (quote_id, tenant_id, snoozed_until, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (quote_id) DO UPDATE
           SET snoozed_until = EXCLUDED.snoozed_until, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [quote.id, s.tenantId, until, who],
      );
    } else {
      return bad("invalid_action", "action must be assign or snooze.");
    }
    clearQueueCache(s.tenantId);
    return json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") return bad("not_migrated", "The review queue isn't set up yet (migration 044).", 503);
    console.error("[admin/review-queue] POST failed:", e);
    return bad("server_error", "Couldn't save. Please try again.", 500);
  }
}
