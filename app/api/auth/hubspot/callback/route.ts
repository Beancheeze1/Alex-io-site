// app/api/auth/hubspot/callback/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lazy KV import so this works even if KV isn't present in dev
async function kvSetSafe(key: string, value: string) {
  try {
    const mod = await import("@/lib/kv").catch(() => null as any);
    const kv: any = mod?.kv ?? mod?.default;
    if (kv?.set) await kv.set(key, value);
  } catch {
    /* ignore */
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID!;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET!;
    const base = process.env.NEXT_PUBLIC_BASE_URL!;
    const redirectUri = `${base.replace(/\/$/, "")}/api/auth/hubspot/callback`;

    if (!clientId || !clientSecret || !base) {
      return NextResponse.json(
        { ok: false, error: "missing_env", missing: { HUBSPOT_CLIENT_ID: !clientId, HUBSPOT_CLIENT_SECRET: !clientSecret, NEXT_PUBLIC_BASE_URL: !base } },
        { status: 400 }
      );
    }

    // Exchange authorization code for tokens
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
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: `non_json_response ${res.status}`, raw: text.slice(0, 300) }, { status: 500 });
    }

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `token_exchange_failed ${res.status}`, details: json }, { status: res.status });
    }

    const access = json.access_token as string | undefined;
    const refresh = json.refresh_token as string | undefined;

    if (refresh) {
      // Persist refresh to KV so /api/hubspot/refresh can use it
      await kvSetSafe("hs:refresh_token", refresh);
    }

    // Simple success page for the browser
    return NextResponse.json({
      ok: true,
      note: "OAuth complete",
      have_access: !!access,
      have_refresh: !!refresh,
      hint: "You can now call /api/hubspot/refresh to mint new access tokens.",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
