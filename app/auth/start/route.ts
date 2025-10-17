import { NextResponse } from "next/server";

export async function GET() {
  const base = "https://app.hubspot.com/oauth/authorize";

  // Read envs as strings; avoid TS “possibly undefined”
  const client_id = process.env.HUBSPOT_CLIENT_ID ?? "";
  const client_secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
  const redirect_uri = process.env.HUBSPOT_REDIRECT_URI ?? "";
  const scope = encodeURIComponent(process.env.HUBSPOT_OAUTH_SCOPES || "oauth");

  // Report exactly which envs are present/missing
  const missing = {
    HUBSPOT_CLIENT_ID: client_id.length > 0,
    HUBSPOT_CLIENT_SECRET: client_secret.length > 0,
    HUBSPOT_REDIRECT_URI: redirect_uri.length > 0,
  };

  if (!missing.HUBSPOT_CLIENT_ID || !missing.HUBSPOT_CLIENT_SECRET || !missing.HUBSPOT_REDIRECT_URI) {
    return NextResponse.json(
      { ok: false, error: "missing_env", missing },
      { status: 500 }
    );
  }

  // Prevent “dead localhost” in prod by mistake
  if (process.env.NODE_ENV === "production" && redirect_uri.includes("localhost")) {
    return NextResponse.json(
      { ok: false, error: "redirect_mismatch", redirect_uri },
      { status: 400 }
    );
  }

  // ✅ Proper template string with backticks + encodeURIComponent
  const url = `${base}?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&scope=${scope}`;

  return NextResponse.redirect(url, { status: 302 });
}
