// app/api/auth/hubspot/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const base = "https://app.hubspot.com/oauth/authorize";
  const client_id = process.env.HUBSPOT_CLIENT_ID!;
  const redirect_uri = process.env.HUBSPOT_REDIRECT_URI!;
  const scope = encodeURIComponent(process.env.HUBSPOT_OAUTH_SCOPES || "oauth");
  const url = `${base}?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&scope=${scope}`;

  return NextResponse.json({ ok: true, url }, { status: 200 });
}
