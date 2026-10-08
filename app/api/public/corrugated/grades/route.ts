// app/api/public/corrugated/grades/route.ts
//
// GET /api/public/corrugated/grades?tenant=<slug>
// The shop's ACTIVE board grades for the Start Quote / rep form picker:
//   { ok, grades: [{ id, name, flute, ect_label, is_default }] }
// Never returns costs. Empty list when the shop has none (picker hides).
//
// Which shop: a real tenant subdomain wins; on the core host a valid
// ?tenant= slug; else the logged-in user's tenant (rep form); else "default".
// Seeds the shop's default corrugated settings on first use (Chuck, Oct 2026:
// every shop gets defaults automatically). 30/min per IP.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { ensureCorrugatedDefaults } from "@/lib/corrugated";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function tenantIdForSlug(slug: string): Promise<number | null> {
  const t = await one<{ id: number }>(
    `SELECT id FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`,
    [slug],
  );
  return t ? Number(t.id) : null;
}

export async function GET(req: NextRequest) {
  const rate = await rateLimit(req, 30, "corr-grades");
  if (!rate.success) return rateLimitResponse(rate.reset);

  try {
    const fromHeader = (req.headers.get("x-tenant-slug") || "").trim().toLowerCase();
    const qp = (req.nextUrl.searchParams.get("tenant") || "").trim().toLowerCase();

    let tenantId: number | null = null;
    if (fromHeader && fromHeader !== "default") {
      tenantId = await tenantIdForSlug(fromHeader);
    } else if (SLUG_RE.test(qp)) {
      tenantId = await tenantIdForSlug(qp);
    } else {
      const user = await getCurrentUserFromRequest(req);
      const userTenant = Number(user?.tenant_id);
      tenantId = Number.isInteger(userTenant) && userTenant > 0 ? userTenant : await tenantIdForSlug("default");
    }
    if (!tenantId) return json({ ok: true, grades: [] });

    // Every shop gets the default flutes + grades the first time (no-op after).
    await ensureCorrugatedDefaults(tenantId);

    const rows = await q<{ id: string | number; name: string; flute: string; ect_label: string | null; is_default: boolean }>(
      `SELECT id, name, flute, ect_label, is_default
         FROM public.corrugated_board_grades
        WHERE tenant_id = $1 AND active = true
        ORDER BY sort_order, id`,
      [tenantId],
    );
    return json({
      ok: true,
      grades: rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        flute: String(r.flute),
        ect_label: String(r.ect_label ?? ""),
        is_default: r.is_default === true,
      })),
    });
  } catch (e: any) {
    if (e?.code === "42P01") return json({ ok: true, grades: [] });
    console.error("[public/corrugated/grades] failed:", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
