// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function env(name: string, required = false) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}

async function getAppToken() {
  const tenant = env("MS_TENANT_ID", true);
  const clientId = env("MS_CLIENT_ID", true);
  const clientSecret = env("MS_CLIENT_SECRET", true);

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, { method: "POST", body });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(`token_fetch_failed ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token as string;
}

export async function POST(req: Request) {
  try {
    const { to, subject, html, threadId } = await req.json();
    const mailbox = env("MS_MAILBOX_FROM", true);

    const token = await getAppToken();

    // Reply in-thread (if threadId provided) — clean reply body, no quoting.
    if (threadId) {
      const endpoint = `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${encodeURIComponent(String(threadId))}/reply`;
      const body = {
        comment: "",
        message: {
          internetMessageHeaders: [{ name: "X-AlexIO-Responder", value: "1" }],
          toRecipients: [{ emailAddress: { address: to } }],
          subject: subject || undefined,
          body: { contentType: "HTML", content: html || "" },
        },
      };

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.error("[msgraph] reply error", r.status, t);
        return NextResponse.json({ ok: false, status: r.status, detail: t, mode: "reply_error" }, { status: 200 });
      }
      return NextResponse.json({ ok: true, mode: "reply_thread", to, threadId });
    }

    // Fallback: sendMail (new thread)
    const sendEndpoint = `https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`;
    const body = {
      message: {
        subject: subject || "Re: your message",
        internetMessageHeaders: [{ name: "X-AlexIO-Responder", value: "1" }],
        body: { contentType: "HTML", content: html || "" },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    };

    const r = await fetch(sendEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[msgraph] sendMail error", r.status, t);
      return NextResponse.json({ ok: false, status: r.status, detail: t, mode: "sendMail_error" }, { status: 200 });
    }
    return NextResponse.json({ ok: true, mode: "sendMail_fallback", to });
  } catch (e: any) {
    console.error("[msgraph] exception", e?.message || String(e));
    return NextResponse.json({ ok: false, error: e?.message || "msgraph_exception" }, { status: 500 });
  }
}
