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
  /** Optional: Internet Message-Id we’re replying to (with or without < >) */
  inReplyTo?: string;
  /** Optional fallback References header */
  references?: string;
};

function normalizeSubject(s: string) {
  return s.replace(/^\s*(re:|fwd:)\s*/i, "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const mailbox = requireEnv("MS_MAILBOX_FROM"); // e.g., sales@alex-io.com
    const { to, subject, html, inReplyTo, references }: SendInput = await req.json();

    if (!to || !subject || !html) {
      return NextResponse.json({ ok: false, error: "missing to/subject/html" }, { status: 400 });
    }

    const token = await getAppToken();

    async function g(path: string, init: RequestInit, extraHeaders?: Record<string, string>) {
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(extraHeaders || {}),
          ...(init.headers || {}),
        },
      });
      const text = await r.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      return { ok: r.ok, status: r.status, json };
    }

    // ---------- Strategy A: exact reply by Internet Message-Id ----------
    if (inReplyTo) {
      const bracketed = inReplyTo.startsWith("<") ? inReplyTo : `<${inReplyTo}>`;
      const esc = bracketed.replace(/'/g, "''"); // OData escaping
      const search = await g(`/messages?$filter=internetMessageId eq '${esc}'&$top=1`, { method: "GET" });

      if (search.ok && Array.isArray(search.json.value) && search.json.value.length > 0) {
        const msgId = search.json.value[0].id as string;

        // Create a reply, patch body + To, then send
        const create = await g(`/messages/${msgId}/createReply`, { method: "POST", body: JSON.stringify({ message: {} }) });
        if (create.ok) {
          const draftId = create.json?.id ?? create.json?.message?.id;
          if (draftId) {
            await g(`/messages/${draftId}`, {
              method: "PATCH",
              body: JSON.stringify({
                subject,
                toRecipients: [{ emailAddress: { address: to } }],
                body: { contentType: "HTML", content: html },
              }),
            });
            const send = await g(`/messages/${draftId}/send`, { method: "POST", body: "{}" });
            if (send.ok) return NextResponse.json({ ok: true, mode: "reply_by_messageId" }, { status: 200 });
            return NextResponse.json({ ok: false, error: "send_reply_failed", detail: send.json }, { status: 200 });
          }
        }
        // fall through to Strategy B if createReply fails
      }
    }

    // ---------- Strategy B: heuristic reply (same sender + subject) ----------
    // Find the most recent message FROM this sender whose normalized subject matches our normalized subject
    const base = normalizeSubject(subject);
    // Filter is efficient; we’ll fetch a few recent items and match the subject locally.
    const list = await g(
      `/messages?$filter=from/emailAddress/address eq '${to.replace(/'/g, "''")}'&$orderby=receivedDateTime desc&$top=10`,
      { method: "GET" }
    );

    if (list.ok && Array.isArray(list.json.value)) {
      const match = (list.json.value as any[]).find((m) => normalizeSubject(String(m.subject || "")) === base);
      if (match?.id) {
        const create = await g(`/messages/${match.id}/createReply`, { method: "POST", body: JSON.stringify({ message: {} }) });
        if (create.ok) {
          const draftId = create.json?.id ?? create.json?.message?.id;
          if (draftId) {
            await g(`/messages/${draftId}`, {
              method: "PATCH",
              body: JSON.stringify({
                subject,
                toRecipients: [{ emailAddress: { address: to } }],
                body: { contentType: "HTML", content: html },
              }),
            });
            const send = await g(`/messages/${draftId}/send`, { method: "POST", body: "{}" });
            if (send.ok) return NextResponse.json({ ok: true, mode: "reply_by_sender_subject" }, { status: 200 });
            return NextResponse.json({ ok: false, error: "send_reply_failed", detail: send.json }, { status: 200 });
          }
        }
      }
    }

    // ---------- Strategy C: sendMail with threading headers (last resort) ----------
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
    if (!sendMail.ok) {
      return NextResponse.json({ ok: false, error: "sendMail_failed", detail: sendMail.json }, { status: 200 });
    }
    return NextResponse.json({ ok: true, mode: "sendMail_fallback" }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send_exception" }, { status: 500 });
  }
}
