import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("dryRun") === "1") {
    return NextResponse.json({ ok: true, route: "/api/ms/send", dryRun: true });
  }
  return NextResponse.json({ ok: false, error: "Use POST to send mail" });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { to, subject, text, html } = body;

    if (!to || !subject || (!text && !html)) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${process.env.MS_MAILBOX_FROM}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getAccessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            body: {
              contentType: html ? "HTML" : "Text",
              content: html || text,
            },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: true,
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Graph sendMail error:", errText);
      return NextResponse.json({ ok: false, error: "Graph send failed", detail: errText }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sent: { from: process.env.MS_MAILBOX_FROM, to, subject } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "Internal error", detail: String(e) }, { status: 500 });
  }
}

// 🔐 Helper: Exchange client credentials for Graph token
async function getAccessToken() {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  const json = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(json.error_description || "Token request failed");
  return json.access_token;
}
