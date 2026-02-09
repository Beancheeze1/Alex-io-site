import { NextResponse } from "next/server";
import { loadFacts, saveFacts } from "@/app/lib/memory";

export async function POST(req: Request) {
  const { quoteNo } = await req.json();

  const facts: any = await loadFacts(String(quoteNo));
  facts.stage_pending_bump = true;
  await saveFacts(String(quoteNo), facts);

  return NextResponse.json({ ok: true });
}
