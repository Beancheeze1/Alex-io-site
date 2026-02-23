// app/api/admin/migrate/route.ts
//
// Admin-only migrations endpoint.
// - GET  /api/admin/migrate   -> list applied + pending migrations
// - POST /api/admin/migrate   -> apply pending migrations (deterministic order)
//
// Path A: minimal + explicit. Nothing auto-runs.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { listMigrations, runPendingMigrations } from "@/lib/migrate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Err = {
  ok: false;
  error: string;
  message: string;
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: Err, status = 400) {
  return NextResponse.json(body, { status });
}

function requireAdmin(user: any) {
  return isRoleAllowed(user, ["admin"]);
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!requireAdmin(user)) {
      return bad(
        { ok: false, error: "forbidden", message: "Admin role required." },
        403,
      );
    }

    const out = await listMigrations();
    return ok(out, 200);
  } catch (e: any) {
    return bad(
      {
        ok: false,
        error: "migrate_list_failed",
        message: String(e?.message || e),
      },
      500,
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!requireAdmin(user)) {
      return bad(
        { ok: false, error: "forbidden", message: "Admin role required." },
        403,
      );
    }

    // Consume body (optional). Keeping contract stable for future flags.
    await req.json().catch(() => null);

    const out = await runPendingMigrations();
    return ok(out, 200);
  } catch (e: any) {
    return bad(
      {
        ok: false,
        error: "migrate_apply_failed",
        message: String(e?.message || e),
      },
      500,
    );
  }
}