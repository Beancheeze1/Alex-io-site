// app/api/admin/corrugated/price/route.ts
//
// Admin "Price check" for Admin -> Corrugated: prices a custom-size RSC from
// the caller's own shop's SAVED corrugated settings (lib/corrugated.ts
// priceCustomRsc -> lib/corrugated-price.ts). Admin only. Read-only.
//
// POST { L, W, D, quantities: number[], grade_id?: number|null,
//        colors?: ("spot"|"flood")[], sides?: 1|2 }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { priceCustomRsc } from "@/lib/corrugated";
import type { Coverage } from "@/lib/corrugated-price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
  if (!isRoleAllowed(user, ["admin"])) {
    return json({ ok: false, error: "forbidden", message: "Admins only." }, 403);
  }
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);
  const tenantId = Number(user.tenant_id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return json({ ok: false, error: "no_tenant", message: "Your account has no shop." }, 400);
  }

  const b = (await req.json().catch(() => null)) as Record<string, any> | null;
  if (!b || typeof b !== "object") {
    return json({ ok: false, error: "invalid_body", message: "Expected a JSON body." }, 400);
  }

  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const quantities = Array.isArray(b.quantities) ? b.quantities.map(num) : [];
  const colors = (Array.isArray(b.colors) ? b.colors.map(String) : []) as Coverage[];
  const grade_id =
    b.grade_id === null || b.grade_id === undefined || b.grade_id === "" ? null : Number(b.grade_id);
  if (grade_id !== null && (!Number.isInteger(grade_id) || grade_id <= 0)) {
    return json({ ok: false, error: "invalid_grade", message: "Invalid board grade." }, 400);
  }
  const sides: 1 | 2 = Number(b.sides) === 2 ? 2 : 1;

  try {
    const result = await priceCustomRsc(tenantId, {
      dims: { L: num(b.L), W: num(b.W), D: num(b.D) },
      quantities,
      grade_id,
      colors,
      sides,
    });
    return json(result, result.ok ? 200 : 400);
  } catch (e: any) {
    if (e?.code === "42P01" || e?.code === "42703") {
      return json({ ok: false, error: "not_migrated", message: "Corrugated tables are missing. Run migration 025." }, 503);
    }
    console.error("[admin/corrugated/price] failed:", e);
    return json({ ok: false, error: "server_error", message: "Could not price the box." }, 500);
  }
}
