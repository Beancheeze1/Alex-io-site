import { NextResponse } from "next/server";
import { verifyState, exchangeCode } from "@/lib/hubspot";
import { tokenStore } from "@/lib/tokenStore";
import { requireEnv } from "@/lib/env";
import { randomBytes } from "node:crypto";



export const runtime = "nodejs";
export const dynamic = "force-dynamic";




export async function GET(req: Request) {
  requireEnv();

  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing code/state" }, { status: 400 });
  }

  // Read cookie fallback
  const cookieHeader = new Headers(req.headers).get("cookie") || "";
  const cookieState = parseCookie(cookieHeader)["hs_oauth_state"];

  // Accept if either KV (primary) OR cookie (fallback) verifies
  const kvOk = await verifyState(state);
  const cookieOk = !!cookieState && cookieState === state;

  if (!kvOk && !cookieOk) {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }

  try {
    const { token, info } = await exchangeCode(code);
const hubId = typeof token.hubId === "number" ? token.hubId : undefined;

// store under portal key
tokenStore.set(token, hubId);
// also store as default for convenience
tokenStore.set(token);


    // Clear cookie to avoid reuse
    const res = NextResponse.json({ ok: true, hubId: token.hubId ?? null, info });
    res.cookies.set("hs_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

function parseCookie(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  h.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}


function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
