import { NextResponse } from "next/server";
import { getCooldownTTL } from "@/lib/dedupe";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

  const ttl = await getCooldownTTL(threadId);
  return NextResponse.json({ ok: true, threadId, secondsRemaining: ttl }, { status: 200 });
}

