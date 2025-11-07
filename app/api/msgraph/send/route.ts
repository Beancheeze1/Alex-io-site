// app/api/msgraph/send/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * Sends email via Microsoft Graph.
 *
 * Supports two modes transparently:
 *  - "reply" (threaded): when an Internet-Message-ID is provided (best)
 *  - "sendMail_fallback": when no thread context exists (still works, new thread)
 *
 * INPUT (JSON):
 * {
 *   "to": "customer@example.com",
 *   "subject": "Re: something",
 *   "html": "<p>...</p>",
 *   // Optional threading inputs:
 *   "internetMessageId": "<message-id@domain>",    // preferred for threading
 *   "inReplyTo": "<message-id@domain>",            // accepted synonym; we map it
 *   // Optional flags
 *   "dryRun": false
 * }
 *
 * OUTPUT (JSON): { ok, status, mode, note?, detail? }
 */

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

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`token_error ${r.status}: ${t}`);
  }
  const j = await r.json();
  return j.access_token as string;
}

type SendInput = {
  to?: string;
  subject?: string;
  html?: string;
  internetMessageId?: string | null;
  inReplyTo?: string | null;
  dryRun?: boolean;
};

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const fromMailbox = requireEnv("MS_MAILBOX_FROM"); // e.g., sales@alex-io.com
    const input = (await req.json()) as SendInput;

    const to = (input.to || "").trim();
    const subject = input.subject ?? "";
    const html = input.html ?? "";
    const dryRun = !!input.dryRun;

    // Normalize thread id sources
    const threadMsgId =
      (input.internetMessageId || input.inReplyTo || "")
        .trim()
        .replace(/^<|>$/g, "") || null;

    if (!to || !subject || !html) {
      return NextResponse.json(
        {
          ok: false,
          status: 400,
          error: "missing_fields",
          detail: { to: !!to, subject: !!subject, html: !!html },
        },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        status: 200,
        mode: threadMsgId ? "reply(dryRun)" : "sendMail_fallback(dryRun)",
        to,
        subject,
        hasThreadId: !!threadMsgId,
      });
    }

    const token = await getAppToken();

    // Graph payload
    // We always build a "new message" and let Graph thread it with headers when possible.
    // NOTE: internetMessageHeaders are respected on v1.0 for sendMail(createMessage+send).
    // If threadMsgId exists, we add In-Reply-To and References headers.
    const message: any = {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      from: { emailAddress: { address: fromMailbox } }, // explicit for clarity
    };

    if (threadMsgId) {
      message.internetMessageHeaders = [
        { name: "In-Reply-To", value: `<${threadMsgId}>` },
        { name: "References", value: `<${threadMsgId}>` },
      ];
    }

    // POST /users/{sender}/sendMail
    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      fromMailbox
    )}/sendMail`;

    const r = await fetch(sendUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message,
        saveToSentItems: true,
      }),
    });

    if (!r.ok) {
      const detail = await safeText(r);
      // Produce structured note codes we can grep in Render logs
      const note =
        r.status === 403
          ? "access_denied"
          : r.status === 404
          ? "reply_target_not_found"
          : "graph_send_error";

      return NextResponse.json(
        {
          ok: false,
          status: r.status,
          mode: threadMsgId ? "reply" : "sendMail_fallback",
          note,
          detail,
          ms: Date.now() - started,
        },
        { status: 200 } // keep 200 to not confuse upstream webhook pipelines
      );
    }

    return NextResponse.json({
      ok: true,
      status: 202,
      mode: threadMsgId ? "reply" : "sendMail_fallback",
      to,
      subject,
      hasInternetMessageId: !!threadMsgId,
      ms: Date.now() - started,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        status: 500,
        note: "msgraph_send_exception",
        detail: String(err?.message || err),
      },
      { status: 200 }
    );
  }
}

async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return null;
  }
}
