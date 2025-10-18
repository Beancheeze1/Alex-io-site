import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/hubspot.js";
import { setToken } from "@/lib/oauthStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenExchangeOk = {
  ok: true;
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  hub_id?: number | null; // HubSpot returns hub_id on some responses
};

type TokenExchangeFail = { ok: false; error: string; status?: number; detail?: unknown };
type TokenExchange = TokenExchangeOk | TokenExchangeFail;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
  if (!code) return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });

  const r = (await exchangeCodeForTokens(code)) as TokenExchange;

  if (!r.ok || !("access_token" in r) || !r.access_token) {
    return NextResponse.json({ ok: false, error: "exchange_failed", detail: r }, { status: 400 });
  }

  await setToken({
    accessToken: r.access_token,
    refreshToAken: r.refresh_token || null,
    expires_in: r.expires_in ?? null,
    portalId: r.hub_id ?? null
  });

  return NextResponse.json({ ok: true, stored: true }, { status: 200 });
}
