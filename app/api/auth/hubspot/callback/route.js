// /app/api/auth/hubspot/callback/route.js
import { NextResponse } from "next/server";
import { saveToken } from "@/lib/oauthStore.js";

export const runtime = "nodejs";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const redirect_uri = process.env.HUBSPOT_REDIRECT_URI || "http://localhost:3000/api/auth/hubspot/callback";
    const client_id = process.env.HUBSPOT_CLIENT_ID;
    const client_secret = process.env.HUBSPOT_CLIENT_SECRET;

    if (!code) {
      return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
    }
    if (!client_id || !client_secret) {
      return NextResponse.json({ ok: false, error: "Missing HUBSPOT_CLIENT_ID/SECRET env" }, { status: 500 });
    }

    // 1) exchange code -> access_token
    const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id,
        client_secret,
        redirect_uri,
        code,
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return NextResponse.json({ ok: false, step: "token", error: tokenJson }, { status: 400 });
    }

    const access_token = tokenJson.access_token;

    // 2) figure out which portal (hubId) this token belongs to
    const whoRes = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${access_token}`);
    const who = await whoRes.json();
    if (!whoRes.ok) {
      return NextResponse.json({ ok: false, step: "identify", error: who }, { status: 400 });
    }

    const hubId = who.hub_id || who.hubId || who.user?.hubId;
    const scopes = who.scopes || tokenJson.scopes || [];

    if (!hubId) {
      return NextResponse.json({ ok: false, error: "Could not determine hubId" }, { status: 400 });
    }

    // 3) SAVE the token so /caps and the quote route can use it
    saveToken(hubId, access_token);

    return NextResponse.json({ ok: true, hubId, scopes });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
