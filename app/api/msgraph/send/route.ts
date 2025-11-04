// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("client_secret", clientSecret);
  body.set("grant_type", "client_credentials");

  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`token_failed ${resp.status} ${JSON.stringify(json)}`);
  return json.access_token as string;
}

type SendInput = {
  to: string;
  subject: string;
  html: string;
  /** Optional: Internet Message-Id of the inbound email we’re replying to */
  inReplyTo?: string;
  /** Optional: explicit references header to carry thread */
  references?: string;
};

export async function POST(req: Request) {
  try {
    const mailbox = requireEnv("MS_MAILBOX_FROM"); // e.g., sales@alex-io.com
    const { to, subject, html, inReplyTo, references }: SendInput = await req.json();

    if (!to || !subject || !html) {
      return NextResponse.json({ ok: false, error: "missing to/subject/html" }, { status: 400 });
    }

    const token = await getAppToken();

    // Helper for Graph calls
    async function g(path: string, init: RequestInit) {
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
      const text = await r.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      return { ok: r.ok, status: r.status, json };
    }

    // If we were given an Internet Message-Id, try replying to that exact message
    if (inReplyTo) {
      // Graph stores this in internetMessageId with <angle-brackets>
      const bracketed = inReplyTo.startsWith("<") ? inReplyTo : `<${inReplyTo}>`;
      const search = await g(`/messages?$filter=internetMessageId eq '${bracketed.replace(/'/g, "''")}'&$top=1`, {
        method: "GET",
      });

      if (search.ok && Array.isArray(search.json.value) && search.json.value.length > 0) {
        const msgId = search.json.value[0].id as string;

        // Create a reply, set HTML body, then send
        const create = await g(`/messages/${msgId}/createReply`, {
          method: "POST",
          body: JSON.stringify({ message: {}}),
        });
        if (create.ok) {
          const draftId = create.json?.id ?? create.json?.message?.id;
          if (draftId) {
            // Update draft body and To (we control recipients)
            await g(`/messages/${draftId}`, {
              method: "PATCH",
              body: JSON.stringify({
                subject, // keep subject aligned
                toRecipients: [{ emailAddress: { address: to } }],
                body: { contentType: "HTML", content: html },
              }),
            });
            const send = await g(`/messages/${draftId}/send`, { method: "POST", body: "{}" });
            if (send.ok) return NextResponse.json({ ok: true, mode: "reply", status: 200 });
            return NextResponse.json({ ok: false, error: "send_reply_failed", detail: send.json }, { status: 200 });
          }
        }
        // If createReply fails, fall through to sendMail with headers
      }
    }

    // Fallback: sendMail with In-Reply-To / References headers to keep threading
    const headers: Array<{ name: string; value: string }> = [];
    if (inReplyTo) headers.push({ name: "In-Reply-To", value: inReplyTo });
    if (references) headers.push({ name: "References", value: references });

    const mail = {
      message: {
        subject,
        toRecipients: [{ emailAddress: { address: to } }],
        from: { emailAddress: { address: mailbox } },
        body: { contentType: "HTML", content: html },
        ...(headers.length ? { internetMessageHeaders: headers } : {}),
      },
      saveToSentItems: true,
    };

    const sendMail = await g(`/sendMail`, { method: "POST", body: JSON.stringify(mail) });
    if (!sendMail.ok) return NextResponse.json({ ok: false, error: "sendMail_failed", detail: sendMail.json }, { status: 200 });

    return NextResponse.json({ ok: true, mode: "sendMail", status: 200 }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send_exception" }, { status: 500 });
  }
}
