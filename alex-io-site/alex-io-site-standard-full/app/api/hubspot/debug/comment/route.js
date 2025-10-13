// app/api/hubspot/debug/comment/route.js
import { NextResponse } from "next/server";
import { postMessageToThread } from "../../../lib/hubspot";

export async function POST(req) {
  try {
    const { threadId, text = "ALEX-IO debug ✅" } = await req.json();
    if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

    const out = await postMessageToThread(threadId, text);
    console.log("🧪 debug posted to thread", threadId);
    return NextResponse.json({ ok: true, out }, { status: 200 });
  } catch (e) {
    console.error("🧪 debug failed:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
