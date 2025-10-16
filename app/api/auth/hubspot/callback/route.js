import { NextResponse } from "next/server";
import { saveToken } from "@/lib/oauthStore";
export const runtime = "nodejs";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) return NextResponse.json({ ok:false, error:"no code" }, { status: 400 });

    const cid = process.env.HUBSPOT_CLIENT_ID;
    const secret = process.env.HUBSPOT_CLIENT_SECRET;
    const redirect = process.env.HUBSPOT_REDIRECT_URI;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cid,
      client_secret: secret,
      redirect_uri: redirect,
      code,
    });

    const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
      body,
    });
    const j = await r.json();
    if (!r.ok) return NextResponse.json({ ok:false, step:"token", error:j }, { status: r.status });

    // Get hub info to know which portal this token belongs to
    const who = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${j.access_token}`);
    const wj = await who.json();
    const hubId = wj.hub_id;

    saveToken(hubId, j.access_token, j.expires_in);
    return NextResponse.json({ ok:true, hubId, scopes: wj.scopes });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e) }, { status: 500 });
  }
}
