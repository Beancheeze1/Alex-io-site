// app/api/admin/mem/route.ts
//
// Simple memory/debug endpoint.
// - GET /api/admin/mem          -> shows memSelfTest + store info
// - GET /api/admin/mem?key=XYZ  -> same plus the facts for that key
//
// NEW (internal):
// - POST /api/admin/mem         -> merge + save facts for a key (e.g., set revision)
//
// USE ONLY FOR INTERNAL DEBUG (no auth yet).

import { NextRequest, NextResponse } from "next/server";
import {
  loadFacts,
  saveFacts,
  memSelfTest,
  LAST_STORE,
  REDIS_LAST_ERROR,
} from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asNonEmptyString(v: any): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

export async function GET(req: NextRequest) {
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
  try {
    // Body supports:
    // {
    //   "key": "Q-AI-...",
    //   "revision": "RevAS"
    // }
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

    // Currently we only need revision, but this endpoint is a general mem merge tool.
    const revisionRaw = body?.revision;
    const revision = asNonEmptyString(revisionRaw);

    if (!revision) {
      return NextResponse.json(
        { ok: false, error: "MISSING_REVISION", message: "Provide body.revision (e.g., RevAS)." },
        { status: 400 }
      );
    }

    // Load existing facts (if any) and merge.
    const existing = (await loadFacts(key)) || {};
    const merged = {
      ...(existing as any),
      revision, // single source for revision label for now
      revision_updated_at: new Date().toISOString(),
    };

    await saveFacts(key, merged);

    return NextResponse.json(
      {
        ok: true,
        mode: "saved",
        key,
        saved: { revision: merged.revision, revision_updated_at: merged.revision_updated_at },
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
