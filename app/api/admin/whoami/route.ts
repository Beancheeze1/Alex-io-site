// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function truthy(v?: string | null) {
  if (!v) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (s === "0" || s.toLowerCase() === "false" || s.toLowerCase() === "null") return false;
  return true;
}

export async function GET() {
  const env = {
    NEXT_PUBLIC_BASE_URL: truthy(process.env.NEXT_PUBLIC_BASE_URL) ? "True" : "missing",
    HUBSPOT_ACCESS_TOKEN: truthy(process.env.HUBSPOT_ACCESS_TOKEN) ? "True" : "missing",
    HUBSPOT_SKIP_LOOKUP: String(process.env.HUBSPOT_SKIP_LOOKUP ?? "0"),
    MS_TENANT_ID: truthy(process.env.MS_TENANT_ID) ? "True" : "missing",
    MS_CLIENT_ID: truthy(process.env.MS_CLIENT_ID) ? "True" : "missing",
    MS_MAILBOX_FROM: process.env.MS_MAILBOX_FROM || "missing",
    OPENAI_API_KEY: truthy(process.env.OPENAI_API_KEY) ? "True" : "missing",

    // NEW: Upstash Redis REST (presence only)
    UPSTASH_REDIS_REST_URL: truthy(process.env.UPSTASH_REDIS_REST_URL) ? "True" : "missing",
    UPSTASH_REDIS_REST_TOKEN: truthy(process.env.UPSTASH_REDIS_REST_TOKEN) ? "True" : "missing",
    ALEXIO_MEM_TTL_DAYS: String(process.env.ALEXIO_MEM_TTL_DAYS ?? "14"),

    // Helpful to ensure we’re not in an edge/worker runtime
    NODE_ENV: process.env.NODE_ENV || "unknown",
    RUNTIME: "nodejs",
  };

  return NextResponse.json({ ok: true, now: new Date().toISOString(), env }, { status: 200 });
}
