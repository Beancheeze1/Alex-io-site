import { NextResponse } from "next/server";
import { exchangeCode, storeToken, verifyState } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  if (!(await verifyState(state))) {
    return NextResponse.json({ ok: false, error: "Invalid or expired state" }, { status: 400 });
  }

  try {
    const { origin } = url;
    const { token } = await exchangeCode(code, origin);
    await storeToken(token);
    return NextResponse.redirect(`${origin}/?authed=1&hubId=${token.hubId}`);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Auth failed" }, { status: 500 });
  }
}
export {};
