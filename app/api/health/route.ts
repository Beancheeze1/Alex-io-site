// app/api/health/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Simple liveness + minimal env echo (safe values only)
function safeEnv() {
  return {
    vercel: process.env.VERCEL ? "true" : "false",
    node_env: process.env.NODE_ENV ?? "unknown",
  };
}

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "alex-io-site",
      time: new Date().toISOString(),
      env: safeEnv(),
    },
    { status: 200 }
  );
}

// Useful for uptime checks that use HEAD
export async function HEAD() {
  return new Response(null, { status: 200 });
}
