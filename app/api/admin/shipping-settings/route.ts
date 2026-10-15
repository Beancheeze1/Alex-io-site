// app/api/admin/shipping-settings/route.ts
//
// Shop shipping settings (Step 19: each shop sets its own). A shop's admins
// read and set their own shop's rough shipping estimate:
//   - rough_ship_pct: % of foam + packaging (0–100)
//   - shipping_cap_usd: the most the estimate can be
// GET  -> { ok, rough_ship_pct, shipping_cap_usd, source: "db" | "default" }
// POST { rough_ship_pct, shipping_cap_usd? } -> saves the caller's shop row.
// A shop that hasn't saved yet uses the platform default (lib/shipping-settings.ts).
//
// Does NOT touch foam pricing, carton logic, or quote_items directly.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { adminOnly } from "@/lib/admin-auth";
import { loadShippingSettings, saveShippingSettings } from "@/lib/shipping-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: unknown, status = 400) {
  return NextResponse.json(body, { status });
}

function normalizePct(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  // Allow 0–100 for safety; clip extremes.
  return Math.max(0, Math.min(100, n));
}

function normalizeCap(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// ---------- GET: this shop's rough shipping estimate ----------
export const GET = adminOnly(async (req: NextRequest) => {
  try {
    const user = await getCurrentUserFromRequest(req);
    const tenantId = user?.tenant_id != null ? Number(user.tenant_id) : null;
    const s = await loadShippingSettings(Number.isInteger(tenantId) ? tenantId : null);
    return ok({
      ok: true,
      rough_ship_pct: s.rough_ship_pct,
      shipping_cap_usd: s.shipping_cap_usd,
      source: s.source === "shop" ? "db" : "default",
    });
  } catch (err) {
    console.error("Error in GET /api/admin/shipping-settings:", err);
    return bad({ ok: false, error: "SERVER_ERROR", message: "Unexpected error loading shipping settings." }, 500);
  }
});

// ---------- POST: save this shop's rough shipping estimate ----------
export const POST = adminOnly(async (req: NextRequest) => {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin"])) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  const tenantId = Number(user.tenant_id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return bad({ ok: false, error: "NO_TENANT", message: "Your account has no shop." });
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { rough_ship_pct?: unknown; shipping_cap_usd?: unknown }
      | null;

    if (!body || body.rough_ship_pct === undefined) {
      return bad({
        ok: false,
        error: "INVALID_PAYLOAD",
        message: "Expected { rough_ship_pct: number, shipping_cap_usd?: number }.",
      });
    }

    const pct = normalizePct(body.rough_ship_pct);
    if (pct === null) {
      return bad({ ok: false, error: "INVALID_PERCENT", message: "rough_ship_pct must be a number (0–100)." });
    }

    // shipping_cap_usd is optional; keep the shop's current cap when it's not sent.
    let cap: number | null;
    if (body.shipping_cap_usd === undefined) {
      cap = (await loadShippingSettings(tenantId)).shipping_cap_usd;
    } else {
      cap = normalizeCap(body.shipping_cap_usd);
      if (cap === null) {
        return bad({ ok: false, error: "INVALID_CAP", message: "shipping_cap_usd must be a non-negative number." });
      }
    }

    try {
      await saveShippingSettings(tenantId, pct, cap);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "42703" || code === "42P01") {
        return bad(
          { ok: false, error: "NOT_MIGRATED", message: "Shipping settings per shop need migration 034. Run migrations, then save again." },
          503,
        );
      }
      throw e;
    }

    return ok({ ok: true, rough_ship_pct: pct, shipping_cap_usd: cap });
  } catch (err) {
    console.error("Error in POST /api/admin/shipping-settings:", err);
    return bad({ ok: false, error: "SERVER_ERROR", message: "Unexpected error saving shipping settings." }, 500);
  }
});
