// app/api/auth/hubspot/callback/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

/**
 * Exchanges the ?code for tokens and RETURNS the refresh_token in JSON
 * so you can copy it into Render env as HUBSPOT_REFRESH_TOKEN.
 * (No KV dependency.)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const err  = url.searchParams.get("error");
    if (err) {
      return NextResponse.json({ ok: false, error: err }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    const base = process.env.NEXT_PUBLIC_BASE_URL;
    if (!clientId || !clientSecret || !base) {
      return NextResponse.json(
        { ok: false, error: "missing_env", missing: {
          HUBSPOT_CLIENT_ID: !clientId, HUBSPOT_CLIENT_SECRET: !clientSecret, NEXT_PUBLIC_BASE_URL: !base
        }},
        { status: 400 }
      );
    }

    const redirectUri = `${base.replace(/\/$/, "")}/api/auth/hubspot/callback`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch {
      return NextResponse.json({ ok: false, error: `non_json_response ${res.status}`, raw: text.slice(0,300) }, { status: 500 });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `token_exchange_failed ${res.status}`, details: json }, { status: res.status });
    }

    // *** Copy this value into Render as HUBSPOT_REFRESH_TOKEN ***
    const refresh = json.refresh_token as string | undefined;
    const access  = json.access_token as string | undefined;

    return NextResponse.json({
      ok: true,
      note: "Copy refresh_token into Render env as HUBSPOT_REFRESH_TOKEN, then redeploy.",
      redirect_uri: redirectUri,
      have_access: !!access,
      refresh_token: refresh ?? null,        // <-- full value returned for you to copy
      access_preview: access ? `${access.slice(0,6)}...${access.slice(-6)}` : null
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
