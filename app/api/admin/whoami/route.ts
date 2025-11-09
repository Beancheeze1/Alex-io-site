// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Only ever report booleans/flags, never secret values.
function has(name: string) {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0 ? "True" : "missing";
}

export async function GET() {
  try {
    const out = {
      ok: true,
      now: new Date().toISOString(),
      env: {
        NEXT_PUBLIC_BASE_URL: has("NEXT_PUBLIC_BASE_URL"),
        HUBSPOT_ACCESS_TOKEN: has("HUBSPOT_ACCESS_TOKEN"),
        HUBSPOT_SKIP_LOOKUP: process.env.HUBSPOT_SKIP_LOOKUP ?? "unset",
        MS_TENANT_ID: has("MS_TENANT_ID"),
        MS_CLIENT_ID: has("MS_CLIENT_ID"),
        MS_MAILBOX_FROM: process.env.MS_MAILBOX_FROM || "unset",
        // 🔎 New: show whether the AI key is present
        OPENAI_API_KEY: has("OPENAI_API_KEY"),
      },
    };
    return NextResponse.json(out, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "whoami_error" },
      { status: 200 }
    );
  }
}
