// app/api/admin/mem/route.ts
//
// Simple memory/debug endpoint.
// - GET /api/admin/mem          -> shows memSelfTest + store info
// - GET /api/admin/mem?key=XYZ  -> same plus the facts for that key
//
// NEW (internal):
// - POST /api/admin/mem         -> merge + save facts for a key (e.g., set revision)
//
// Admin + CS only.

import { NextRequest, NextResponse } from "next/server";
import {
  loadFacts,
  saveFacts,
  memSelfTest,
  LAST_STORE,
  REDIS_LAST_ERROR,
} from "@/app/lib/memory";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asNonEmptyString(v: any): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs"])) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || url.searchParams.get("id") || null;

    const test = await memSelfTest();

    if (!key) {
      return NextResponse.json(
        {
          ok: true,
          mode: "summary",
          test,
          lastStore: LAST_STORE,
          redisError: REDIS_LAST_ERROR,
        },
        { status: 200 }
      );
    }

    const facts = await loadFacts(key);

    return NextResponse.json(
      {
        ok: true,
        mode: "by-key",
        key,
        test,
        lastStore: LAST_STORE,
        redisError: REDIS_LAST_ERROR,
        facts,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "admin_mem_exception",
        detail: String(e?.message || e),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs"])) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  try {
    // Body supports two forms:
    //
    // Legacy (revision only):
    //   { "key": "Q-AI-...", "revision": "RevAS" }
    //
    // General facts merge (preferred):
    //   { "key": "Q-AI-...", "facts": { "printed": 1, "revision": "RevAS", ... } }
    //
    // Also accepts "quote_no" as key alias.
    const body = await req.json().catch(() => ({} as any));

    const key =
      asNonEmptyString(body?.key) ||
      asNonEmptyString(body?.quote_no) ||
      null;

    if (!key) {
      return NextResponse.json(
        { ok: false, error: "MISSING_KEY", message: "Provide body.key (or body.quote_no)." },
        { status: 400 }
      );
    }

    // Build the patch to merge.
    // Support both { facts: { ... } } and legacy top-level { revision: "..." }.
    const factsPatch: Record<string, any> = {};

    if (body?.facts && typeof body.facts === "object") {
      Object.assign(factsPatch, body.facts);
    }

    // Legacy: top-level revision field
    const revisionRaw = body?.revision;
    const revision = asNonEmptyString(revisionRaw);
    if (revision) {
      factsPatch.revision = revision;
      factsPatch.revision_updated_at = new Date().toISOString();
    }

    if (Object.keys(factsPatch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FACTS", message: "Provide body.facts or body.revision." },
        { status: 400 }
      );
    }

    // Load existing facts (if any) and merge.
    const existing = (await loadFacts(key)) || {};
    const merged = {
      ...(existing as any),
      ...factsPatch,
    };

    await saveFacts(key, merged);

    return NextResponse.json(
      {
        ok: true,
        mode: "saved",
        key,
        saved: factsPatch,
        lastStore: LAST_STORE,
        redisError: REDIS_LAST_ERROR,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "admin_mem_post_exception",
        detail: String(e?.message || e),
      },
      { status: 500 }
    );
  }
}