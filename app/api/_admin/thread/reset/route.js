import { NextResponse } from "next/server";
import { clearThreadLocks } from "@/lib/dedupe";

const SECRET = process.env.ADMIN_SECRET || ""; // optional

export async function POST(req) {
  try {
    const { threadId } = await req.json().catch(() => ({}));
    if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

    if (SECRET) {
      const url = new URL(req.url);
      if (url.searchParams.get("s") !== SECRET) {
        return NextResponse.json({ ok: true, note: "unauthorized" }, { status: 200 });
      }
    }

    await clearThreadLocks(threadId);
    return NextResponse.json({ ok: true, reset: threadId }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

