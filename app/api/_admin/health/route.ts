import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    env: process.env.NODE_ENV,
    baseUrl: process.env.APP_BASE_URL ?? null,
    t: new Date().toISOString(),
    fp: "health-v1"
  });
}
