import { NextResponse } from "next/server";
import { clearCooldown } from "@/lib/dedupe";

export async function POST(req) {
  const { threadId } = await req.json().catch(() => ({}));
  if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });
  await clearCooldown(threadId);
  return NextResponse.json({ ok: true, cleared: threadId }, { status: 200 });
}

