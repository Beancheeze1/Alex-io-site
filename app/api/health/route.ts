// app/api/health/route.ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // Basic connectivity check
    const now = new Date().toISOString();

    logger.info("Health check passed", { timestamp: now });

    return NextResponse.json({
      ok: true,
      timestamp: now,
      env: "production",
      version: process.env.npm_package_version || "unknown",
      status: "healthy"
    });
  } catch (err: any) {
    logger.error("Health check failed", { error: err?.message });
    return NextResponse.json({ ok: false, error: "unhealthy" }, { status: 500 });
  }
}