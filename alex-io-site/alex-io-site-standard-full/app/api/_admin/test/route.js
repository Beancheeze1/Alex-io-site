// app/api/_admin/test/route.js
import { NextResponse } from "next/server";
import { clearThreadLocks, clearDedupeKey } from "@/lib/dedupe";
import { postMessageToThread } from "@/lib/hubspot";

// Optional shared secret; set in Render -> Environment.
// Example: ADMIN_SECRET=abc123  then call .../api/_admin/test?s=abc123
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

// Default test message if none provided
const DEFAULT_TEXT =
  process.env.REPLY_TEMPLATE ||
  "ALEX-IO test ✅ — this was posted by /api/_admin/test";

export async function GET(req) {
  // Small helper so you can quickly see the route is reachable
  const url = new URL(req.url);
  const hasSecret = Boolean(ADMIN_SECRET);
  return NextResponse.json(
    {
      ok: true,
      path: "/api/_admin/test",
      requiresSecret: hasSecret,
      usage: {
        method: "POST",
        body: { threadId: "<required>", text: "(optional)" },
        queryString: hasSecret ? "?s=<ADMIN_SECRET>" : "(none)"
      }
    },
    { status: 200 }
  );
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    if (ADMIN_SECRET && url.searchParams.get("s") !== ADMIN_SECRET) {
      // Return 200 to stay quiet externally but ignore request
      return NextResponse.json({ ok: true, note: "unauthorized" }, { status: 200 });
    }

    const { threadId, text, dedupeKey } = await req.json().catch(() => ({}));
    if (!threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 });
    }

    // 1) Clear any local/Redis locks so the next post won't be blocked
    await clearThreadLocks(threadId);
    if (dedupeKey) {
      await clearDedupeKey(dedupeKey); // optional: if you want to re-run the exact same event
    }

    // 2) Post a COMMENT directly (bypasses webhook)
    const msg = text && String(text).trim().length ? text : DEFAULT_TEXT;

    try {
      const out = await postMessageToThread(threadId, msg, { type: "COMMENT" });
      return NextResponse.json(
        { ok: true, action: "posted", threadId, result: out },
        { status: 200 }
      );
    } catch (err) {
      return NextResponse.json(
        { ok: false, action: "post_failed", threadId, error: err?.message || String(err) },
        { status: 200 }
      );
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

