// app/api/admin/token-check/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// same lookup logic as responder
async function getToken(): Promise<{ token: string | null; source: "env" | "kv" | "none" }> {
  if (process.env.HS_TOKEN) {
    return { token: process.env.HS_TOKEN, source: "env" };
  }
  try {
    const mod: any = await import("@/lib/kv");
    const kv = mod?.kv ?? mod?.default ?? mod?.redis ?? mod?.client ?? null;
    if (kv?.get) {
      const t = await kv.get("hs:oauth:access_token");
      if (typeof t === "string" && t.length > 0) {
        return { token: t, source: "kv" };
      }
    }
  } catch {}
  return { token: null, source: "none" };
}

export async function GET() {
  const { token, source } = await getToken();
  const preview = token ? `${token.slice(0,6)}… (${token.length} chars)` : null;
  return NextResponse.json({
    ok: !!token,
    source,          // "env" | "kv" | "none"
    preview,         // first 6 chars and length
    need: ["conversations.read","conversations.write"],
    hint: source === "none"
      ? "Set HS_TOKEN in Render env or put OAuth token in KV key hs:oauth:access_token."
      : undefined,
  });
}
