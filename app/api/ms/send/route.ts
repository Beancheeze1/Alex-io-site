import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Env we rely on (already set in your Render envs)
const TENANT = process.env.MS_TENANT_ID!;
const CLIENT_ID = process.env.MS_CLIENT_ID!;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET!;
const FROM = process.env.MS_MAILBOX_FROM!; // must be the PRIMARY SMTP of the mailbox

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

async function getAppToken() {
  const url = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.log(`[ms/send] token error ${res.status} ${t}`);
    throw new Error(`token_error_${res.status}`);
  }
  return (await res.json()).access_token as string;
}

type SendInput = {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string[];
};

export async function POST(req: Request) {
  let body: SendInput;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const to = (body.to || "").trim();
  if (!to) return json({ ok: false, error: "missing_to" }, 400);
  if (!body.text && !body.html)
    return json({ ok: false, error: "missing_text_or_html" }, 400);

  // Build Graph message
  const message: any = {
    subject: body.subject || "Re: your message",
    toRecipients: [{ emailAddress: { address: to } }],
    from: { emailAddress: { address: FROM } }, // explicit
    replyTo: (body.replyTo || []).map((a) => ({ emailAddress: { address: a } })),
    body: {
      contentType: body.html ? "HTML" : "Text",
      content: body.html || body.text,
    },
  };

  try {
    const token = await getAppToken();

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      FROM
    )}/sendMail`;

    const payload = {
      message,
      saveToSentItems: true, // <- force Sent Items copy
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Graph sendMail returns 202 Accepted with empty body on success
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    // Emit a compact line so you SEE it in Render logs
    console.log(
      `[ms/send] to=${to} status=${res.status} sentItems=true subject="${message.subject}"`
    );

    if (res.status === 202 || res.ok) {
      return json({
        ok: true,
        sent: {
          from: FROM,
          to,
          subject: message.subject,
          status: res.status,
          graph: parsed, // usually empty on 202
        },
      });
    }

    // Non-2xx — return Graph error
    return json(
      {
        ok: false,
        error: "graph_send_failed",
        status: res.status,
        graph: parsed,
      },
      res.status
    );
  } catch (err: any) {
    console.log(`[ms/send] fatal ${err?.message || err}`);
    return json({ ok: false, error: "fatal", detail: `${err}` }, 500);
  }
}
