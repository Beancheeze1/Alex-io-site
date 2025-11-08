import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  // Simple mock or real lookup logic
  const email = body?.message?.from?.email;
  if (!email) return NextResponse.json({ ok: false, status: 400 });
  return NextResponse.json({ ok: true, email, status: 200 });
}
