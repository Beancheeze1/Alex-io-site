import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "alex-io-site", time: new Date().toISOString() },
    { status: 200 }
  );
}
export async function HEAD() { return new Response(null, { status: 200 }); }
