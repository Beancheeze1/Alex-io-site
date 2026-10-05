// app/api/admin/corrugated/route.ts
//
// Admin -> Corrugated settings for the caller's own tenant.
//   GET -> { ok, settings, flutes, grades }  (seeds defaults on first read)
//   PUT { settings, flutes, grades } -> saves all three, returns the fresh config
// Admin role only. The tenant comes from the logged-in user, never the body.
// Same tenant/host check as /api/admin/shipping-settings.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { loadCorrugated, saveCorrugated, validateCorrugatedInput } from "@/lib/corrugated";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function authTenant(req: NextRequest): Promise<{ tenantId: number } | NextResponse> {
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
  return { tenantId };
}

function schemaMissing(e: any): boolean {
  return e?.code === "42P01" || e?.code === "42703";
}

export async function GET(req: NextRequest) {
  const auth = await authTenant(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const cfg = await loadCorrugated(auth.tenantId);
    return json({ ok: true, ...cfg });
  } catch (e: any) {
    if (schemaMissing(e)) {
      return json({ ok: false, error: "not_migrated", message: "Corrugated tables are missing. Run migration 025." }, 503);
    }
    console.error("[admin/corrugated] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Could not load corrugated settings." }, 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await authTenant(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const v = validateCorrugatedInput(body);
  if (!v.ok) return json({ ok: false, error: "invalid_value", message: v.message }, 400);

  try {
    await saveCorrugated(auth.tenantId, v.value);
    const cfg = await loadCorrugated(auth.tenantId);
    return json({ ok: true, ...cfg });
  } catch (e: any) {
    if (e?.code === "23505") {
      return json({
        ok: false,
        error: "duplicate",
        message: "Two board grades ended up with the same name. If you swapped two names, save once with a temporary name first.",
      }, 409);
    }
    if (schemaMissing(e)) {
      return json({ ok: false, error: "not_migrated", message: "Corrugated tables are missing. Run migration 025." }, 503);
    }
    console.error("[admin/corrugated] PUT failed:", e);
    return json({ ok: false, error: "server_error", message: "Could not save corrugated settings." }, 500);
  }
}
