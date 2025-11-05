// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const b = (v: unknown) => String(v ?? "").toLowerCase() === "true";

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`token error ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.access_token as string;
}

function s(x: unknown) { return typeof x === "string" ? x : x == null ? "" : String(x); }

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const to = s(body?.to);
    const subject = s(body?.subject) || "Thanks for your message";
    const text = s(body?.text);
    const html = s(body?.html);
    const inReplyTo = body?.inReplyTo ? s(body.inReplyTo) : "";

    if (!to) return NextResponse.json({ ok: false, error: "missing to" }, { status: 400 });

    const fromMailbox = requireEnv("MS_MAILBOX_FROM");
    const token = await getAppToken();

    const forceText = b(process.env.REPLY_FORCE_TEXT);
    const hasHtml = html.trim().length > 0;
    const hasText = text.trim().length > 0;

    const bodyContentType = (!forceText && hasHtml) ? ("HTML" as const) : ("Text" as const);
    const bodyContent = bodyContentType === "HTML" ? html : (hasText ? text : "");

    // Always include loop-guard; add threading headers when we have an internet message id
    const internetMessageHeaders: Array<{ name: string; value: string }> = [
      { name: "X-AlexIO-Responder", value: "1" },
    ];
    if (inReplyTo && inReplyTo.length > 6) {
      internetMessageHeaders.push({ name: "In-Reply-To", value: inReplyTo });
      internetMessageHeaders.push({ name: "References", value: inReplyTo });
    }

    const msg = {
      message: {
        subject,
        toRecipients: [{ emailAddress: { address: to } }],
        from: { emailAddress: { address: fromMailbox } },
        internetMessageHeaders,
        body: { contentType: bodyContentType, content: bodyContent },
      },
      saveToSentItems: true,
    };

    const r = await fetch(
      "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(fromMailbox) + "/sendMail",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      }
    );

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "graph_send_failed", status: r.status, details: t.slice(0, 1000) },
        { status: 502 }
      );
    }

    const reqId = r.headers.get("request-id") || "";
    return NextResponse.json({ ok: true, status: 202, requestId: reqId, bodyMode: bodyContentType });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
