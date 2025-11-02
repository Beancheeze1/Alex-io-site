// app/api/msgraph/send/route.ts
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

  const r = await fetch(tokenUrl, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const j = await r.json();
  if (!r.ok) throw new Error(`token error ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.access_token as string;
}

export async function POST(req: Request) {
  try {
    const { to, subject, text, html, inReplyTo, references } = await req.json();

    if (!to) return NextResponse.json({ ok: false, error: "missing to" }, { status: 400 });

    const fromMailbox = requireEnv("MS_MAILBOX_FROM"); // e.g., "sales@alex-io.com"
    const token = await getAppToken();

    const isHtml = !!html;
    const content = isHtml ? html : (text ?? ""); // prefer html when provided

    // Add loop header
    const internetMessageHeaders = [
      { name: "X-AlexIO-Responder", value: "1" },
    ];
    if (inReplyTo) internetMessageHeaders.push({ name: "In-Reply-To", value: inReplyTo });
    if (Array.isArray(references) && references.length)
      internetMessageHeaders.push({ name: "References", value: references.join(" ") });

    const msg = {
      message: {
        subject: subject ?? "Thanks for your message",
        toRecipients: [{ emailAddress: { address: to } }],
        from: { emailAddress: { address: fromMailbox } },
        internetMessageHeaders,
        body: { contentType: isHtml ? "HTML" : "Text", content },
      },
      saveToSentItems: true,
    };

    const r = await fetch("https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(fromMailbox) + "/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "graph send failed", status: r.status, details: t.slice(0, 1000) }, { status: 502 });
    }

    const reqId = r.headers.get("request-id") || r.headers.get("x-ms-ags-diagnostic") || "";
    return NextResponse.json({ ok: true, status: 202, requestId: reqId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
