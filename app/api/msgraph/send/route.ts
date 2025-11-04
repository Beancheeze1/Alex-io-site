import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function POST(req: Request) {
  try {
    const { to, subject, html, threadId } = await req.json();
    const token = await getAppToken();
    const mailbox = requireEnv("MS_MAILBOX_FROM");

    // 🧩 thread support
    const endpoint = threadId
      ? `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${threadId}/reply`
      : `https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`;

    const body = threadId
      ? { comment: "", message: { toRecipients: [{ emailAddress: { address: to } }], body: { contentType: "HTML", content: html } } }
      : { message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] } };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[graph] send error", res.status, err);
      return NextResponse.json({ ok: false, status: res.status, body: err });
    }

    return NextResponse.json({ ok: true, to, mode: threadId ? "reply_thread" : "sendMail_fallback" });
  } catch (err: any) {
    console.error("[graph] error", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) });
  }
}
