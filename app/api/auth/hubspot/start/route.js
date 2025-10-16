// app/auth/start/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const base = "https://app.hubspot.com/oauth/authorize";
  const client_id = process.env.HUBSPOT_CLIENT_ID!;
  const redirect_uri = process.env.HUBSPOT_REDIRECT_URI!;
  const scope = encodeURIComponent(process.env.HUBSPOT_OAUTH_SCOPES || "oauth");

  // Safety checks to prevent silent connection-refused outcomes
  const errs: string[] = [];
  if (!client_id) errs.push("HUBSPOT_CLIENT_ID");
  if (!process.env.HUBSPOT_CLIENT_SECRET) errs.push("HUBSPOT_CLIENT_SECRET");
  if (!redirect_uri) errs.push("HUBSPOT_REDIRECT_URI");
  if (errs.length) {
    return NextResponse.json(
      { ok: false, error: "missing_env", missing: errs },
      { status: 500 }
    );
  }

  // If redirect_uri points to localhost but we are in production, warn
  if (process.env.NODE_ENV === "production" && redirect_uri.includes("localhost")) {
    return NextResponse.json(
      {
        ok: false,
        error: "redirect_mismatch",
        hint:
          "You're in production but HUBSPOT_REDIRECT_URI points to localhost. Set it to your Render domain and add that URL in HubSpot App settings.",
        redirect_uri,
      },
      { status: 400 }
    );
  }

  const url = `${base}?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&scope=${scope}`;

  // 302 redirect straight to HubSpot
  return NextResponse.redirect(url, { status: 302 });
}
