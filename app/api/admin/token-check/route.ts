// app/api/admin/token-check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getToken(): Promise<{ token: string | null; source: "env" | "kv" | "none" }> {
  if (process.env.HS_TOKEN) return { token: process.env.HS_TOKEN, source: "env" };
  try {
    const mod: any = await import("@/lib/kv");
    const kv = mod?.kv ?? mod?.default ?? mod?.redis ?? mod?.client ?? null;
    if (kv?.get) {
      const t = await kv.get("hs:oauth:access_token");
      if (typeof t === "string" && t.length > 0) return { token: t, source: "kv" };
    }
  } catch {}
  return { token: null, source: "none" };
}

export const GET = adminOnly(async (req: NextRequest) => {
  const { token, source } = await getToken();
  const preview = token ? `${token.slice(0,6)}… (${token.length} chars)` : null;
  return NextResponse.json({
    ok: !!token,
    source,
    preview,
    need: ["conversations.read", "conversations.write"],
  });
});
