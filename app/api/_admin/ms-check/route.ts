import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_MAILBOX_FROM: process.env.MS_MAILBOX_FROM || null,
  };

  try {
    // Try to get a token using your envs (but don't return the token)
    const r = await fetch(
      `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MS_CLIENT_ID!,
          client_secret: process.env.MS_CLIENT_SECRET!,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      }
    );

    const json = await r.json();
    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          env,
          token: { ok: false, status: r.status, error: json.error, detail: json.error_description || json },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      env,
      token: { ok: true, token_type: json.token_type, expires_in: json.expires_in },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, env, token: { ok: false, error: "fetch_failed", detail: String(e) } },
      { status: 500 }
    );
  }
}
