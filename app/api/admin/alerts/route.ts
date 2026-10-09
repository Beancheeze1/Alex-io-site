// app/api/admin/alerts/route.ts
//
// Admin alerts for the logged-in staff member's own shop (Step 7).
//
// GET  /api/admin/alerts            -> { ok, unread, alerts: [...latest 50] }
// GET  /api/admin/alerts?count=1    -> { ok, unread }
// POST /api/admin/alerts  { all: true } | { ids: number[] }  -> marks read
//
// Staff only (admin / cs / sales). Always scoped to user.tenant_id.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlertRow = {
  id: number;
  kind: string;
  quote_no: string | null;
  title: string;
  detail: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function staffUser(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user || !isRoleAllowed(user, ["admin", "cs", "sales"]) || user.tenant_id == null) return null;
  return user;
}

export async function GET(req: NextRequest) {
  try {
    const user = await staffUser(req);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    const tenantId = Number(user.tenant_id);

    const unreadRow = await one<{ n: string | number }>(
      `SELECT count(*) AS n FROM public.admin_alerts WHERE tenant_id = $1 AND read_at IS NULL`,
      [tenantId],
    );
    const unread = Number(unreadRow?.n ?? 0);

    if (req.nextUrl.searchParams.get("count") === "1") return json({ ok: true, unread });

    const alerts = await q<AlertRow>(
      `SELECT id, kind, quote_no, title, detail, link, created_at, read_at
         FROM public.admin_alerts
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [tenantId],
    );
    return json({ ok: true, unread, alerts: alerts || [] });
  } catch (e) {
    console.error("[admin/alerts] GET failed:", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await staffUser(req);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    const tenantId = Number(user.tenant_id);

    const b = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (b?.all === true) {
      await q(
        `UPDATE public.admin_alerts SET read_at = now() WHERE tenant_id = $1 AND read_at IS NULL`,
        [tenantId],
      );
      return json({ ok: true });
    }

    const ids = Array.isArray(b?.ids)
      ? b!.ids.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 200)
      : [];
    if (!ids.length) return json({ ok: false, error: "nothing_to_mark" }, 400);

    await q(
      `UPDATE public.admin_alerts SET read_at = now()
        WHERE tenant_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
      [tenantId, ids],
    );
    return json({ ok: true });
  } catch (e) {
    console.error("[admin/alerts] POST failed:", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
