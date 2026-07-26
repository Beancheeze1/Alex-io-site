// app/api/admin/shipping-settings/route.ts
//
// Admin-only global shipping settings.
// Path A safe: tiny single-row table used as a knob.
// - GET:  returns current rough_ship_pct (percent of foam+packaging).
// - POST: updates rough_ship_pct.
//
// Does NOT touch foam pricing, carton logic, or quote_items directly.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

import { q, one } from "@/lib/db";
import { adminOnly } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SettingsRow = {
  id: number;
  rough_ship_pct: number | string;
  shipping_cap_usd: number | string | null;
};

type OkGet = {
  ok: true;
  rough_ship_pct: number;
  shipping_cap_usd: number;
  source: "db" | "default";
};

type OkPost = {
  ok: true;
  rough_ship_pct: number;
  shipping_cap_usd: number;
};

type Err = {
  ok: false;
  error: string;
  message?: string;
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function normalizePct(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  // Allow 0–100 for safety; clip extremes.
  const clipped = Math.max(0, Math.min(100, n));
  return clipped;
}

function normalizeCap(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// ---------- GET: read current rough_ship_pct ----------
export const GET = adminOnly(async (req: NextRequest) => {
  try {
    try {
      const row = (await one<SettingsRow>(
        `
        select id, rough_ship_pct, shipping_cap_usd
        from public.shipping_settings
        order by id asc
        limit 1
        `,
        [],
      )) as SettingsRow | null;

      if (!row) {
        // Table exists but no row; treat as default.
        return ok({
          ok: true,
          rough_ship_pct: 2.0,
          shipping_cap_usd: 200.0,
          source: "default",
        } satisfies OkGet);
      }

      const pct = normalizePct(row.rough_ship_pct);
      const cap = normalizeCap(row.shipping_cap_usd);
      return ok({
        ok: true,
        rough_ship_pct: pct ?? 2.0,
        shipping_cap_usd: cap ?? 200.0,
        source: "db",
      } satisfies OkGet);
    } catch (innerErr: any) {
      const msg = String(innerErr?.message ?? innerErr ?? "");
      const code = (innerErr && (innerErr as any).code) || "";

      // If table/column is missing, just return a sane default
      const isSchemaProblem =
        code === "42P01" || // undefined_table
        code === "42703" || // undefined_column
        msg.includes("shipping_settings");

      if (!isSchemaProblem) {
        throw innerErr;
      }

      console.warn(
        "[/api/admin/shipping-settings] shipping_settings not ready; returning default",
        { code, msg },
      );

      return ok({
        ok: true,
        rough_ship_pct: 2.0,
        shipping_cap_usd: 200.0,
        source: "default",
      } satisfies OkGet);
    }
  } catch (err: any) {
    console.error("Error in GET /api/admin/shipping-settings:", err);
    return bad({
      ok: false,
      error: "SERVER_ERROR",
      message:
        "Unexpected error loading shipping settings. Check logs or DB schema.",
    } satisfies Err, 500);
  }
});

// ---------- POST: update rough_ship_pct ----------
export const POST = adminOnly(async (req: NextRequest) => {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin"])) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => null)) as
      | { rough_ship_pct?: any; shipping_cap_usd?: any }
      | null;

    if (!body || body.rough_ship_pct === undefined) {
      return bad({
        ok: false,
        error: "INVALID_PAYLOAD",
        message: "Expected { rough_ship_pct: number, shipping_cap_usd?: number }.",
      } satisfies Err);
    }

    const pct = normalizePct(body.rough_ship_pct);
    if (pct === null) {
      return bad({
        ok: false,
        error: "INVALID_PERCENT",
        message: "rough_ship_pct must be a number (0–100).",
      } satisfies Err);
    }

    // Try to update an existing row; if none, insert one.
    const existing = (await one<SettingsRow>(
      `
      select id, rough_ship_pct, shipping_cap_usd
      from public.shipping_settings
      order by id asc
      limit 1
      `,
      [],
    ).catch(() => null)) as SettingsRow | null;

    // shipping_cap_usd is optional in the payload; fall back to the existing
    // (or default) value so a caller that only sends rough_ship_pct doesn't
    // clobber the cap.
    let cap: number | null;
    if (body.shipping_cap_usd === undefined) {
      cap = normalizeCap(existing?.shipping_cap_usd) ?? 200.0;
    } else {
      cap = normalizeCap(body.shipping_cap_usd);
      if (cap === null) {
        return bad({
          ok: false,
          error: "INVALID_CAP",
          message: "shipping_cap_usd must be a non-negative number.",
        } satisfies Err);
      }
    }

    if (existing && typeof existing.id === "number") {
      await q(
        `
        update public.shipping_settings
        set rough_ship_pct = $1, shipping_cap_usd = $2
        where id = $3
        `,
        [pct, cap, existing.id],
      );
    } else {
      await q(
        `
        insert into public.shipping_settings (rough_ship_pct, shipping_cap_usd)
        values ($1, $2)
        `,
        [pct, cap],
      );
    }

    return ok({
      ok: true,
      rough_ship_pct: pct,
      shipping_cap_usd: cap,
    } satisfies OkPost);
  } catch (err: any) {
    console.error("Error in POST /api/admin/shipping-settings:", err);
    return bad({
      ok: false,
      error: "SERVER_ERROR",
      message:
        "Unexpected error saving shipping settings. Check logs or DB schema.",
    } satisfies Err, 500);
  }
});