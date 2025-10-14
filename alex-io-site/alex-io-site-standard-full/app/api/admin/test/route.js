// app/api/_admin/test/route.js
import { NextResponse } from "next/server";
import { clearThreadLocks, clearDedupeKey } from "@/lib/dedupe";
import { postMessageToThread } from "@/lib/hubspot";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const DEFAULT_TEXT =
  process.env.REPLY_TEMPLATE ||
  "ALEX-IO test ✅ — this was posted by /api/_admin/test";

export async function GET(req) {
  const url = new URL(req.url);
  return NextResponse.json(
    {
      ok: true,
      path: "/api/_admin/test",
      requiresSecret: Boolean(ADMIN_SECRET),
      usage: {
        method: "POST",
        body: { threadId: "<required>", text: "(optional)", dedupeKey: "(optional)" },
        queryString: ADMIN_SECRET ? "?s=<ADMIN_SECRET>" : "(none)"
      }
    },
    { status: 200 }
  );
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    if (ADMIN_SECRET && url.searchParams.get("s") !== ADMIN_SECRET) {
      return NextResponse.json({ ok: true, note: "unauthorized" }, { status: 200 });
    }

    const { threadId, text, dedupeKey } = await req.json().catch(() => ({}));
    if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

    await clearThreadLocks(threadId);
    if (dedupeKey) await clearDedupeKey(dedupeKey);

    const msg = (text && String(text).trim()) || DEFAULT_TEXT;
    const out = await postMessageToThread(threadId, msg, { type: "COMMENT" });

    return NextResponse.json({ ok: true, action: "posted", threadId, result: out }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}

