// app/api/ai/parse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { extractSlots } from "@/app/lib/parse/matchers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    const text = typeof body.text === "string" ? body.text : "";
    const { slots, sources } = extractSlots(text);
    return NextResponse.json({ ok: true, slots, sources, len: text.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "parse_error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/ai/parse" });
}
