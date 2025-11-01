// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "Failed to fetch Graph token");
  return data.access_token as string;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const accessToken = await getAppToken();

    // Prefer the passed customer email, fallback to self only for internal tests
    const to = body.to || body.customerEmail || "sales@alex-io.com";
    const subject = body.subject || "[Alex-IO] Default Test";
    const html = body.html || `<p>Graph send test message — ${new Date().toISOString()}</p>`;

    const fromMailbox = requireEnv("MS_MAILBOX_FROM");
    const endpoint = `https://graph.microsoft.com/v1.0/users/${fromMailbox}/sendMail`;

    const message = {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    };

    const sendRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    return NextResponse.json({
      ok: true,
      sent: { to, subject },
      graph: { status: sendRes.status, requestId: sendRes.headers.get("request-id") },
    });
  } catch (err: any) {
    console.error("[Graph Send Error]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
