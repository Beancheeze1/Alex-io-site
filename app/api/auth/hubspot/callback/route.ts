import { NextResponse } from "next/server";
// relative paths from /app/api/auth/hubspot/callback to /lib
import { exchangeCodeForTokens, introspect } from "../../../../../lib/hubspot";
import { tokenStore } from "../../../../../lib/tokenStore";


export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");

    if (err) {
      return NextResponse.json(
        { ok: false, step: "callback", error: err, error_description: errDesc },
        { status: 400 }
      );
    }
    if (!code) {
      return NextResponse.json(
        { ok: false, step: "callback", error: "missing_code" },
        { status: 400 }
      );
    }

    const tokens = await exchangeCodeForTokens(code);
    const expires_at = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);
    const info = await introspect(tokens.access_token);
    if (!info?.hub_id) {
      return NextResponse.json(
        { ok: false, step: "introspect", error: "no_hub_id", raw: info },
        { status: 400 }
      );
    }

    await tokenStore.set(info.hub_id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at,
      hub_id: info.hub_id,
      user_id: info.user_id,
      scopes: info.scopes
    });

    const res = NextResponse.json({
      ok: true,
      message: "OAuth complete",
      hub_id: info.hub_id
    });
    res.cookies.set("hs_portal", String(info.hub_id), { httpOnly: true, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, step: "exception", error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

