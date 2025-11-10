// app/api/msgraph/send/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- helpers ---
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function wrapTextAsHtml(text: string) {
  const safe = escapeHtml(text);
  return `<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111"><pre style="white-space:pre-wrap;margin:0">${safe}</pre></div>`;
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Graph token error ${r.status}: ${t}`);
  }
  const json = (await r.json()) as { access_token: string };
  return json.access_token;
}

async function sendViaGraph({
  to,
  subject,
  html,
  inReplyTo,
}: {
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string | null;
}) {
  const accessToken = await getAppToken();
  const from = requireEnv("MS_MAILBOX_FROM"); // e.g., sales@alex-io.com
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    from
  )}/sendMail`;

  // Basic new message; if you later wire true replies, you’ll use reply endpoints.
  const body = {
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Graph send error ${resp.status}: ${t}`);
  }
}

// --- handlers ---
export async function GET() {
  // Intentionally disallow GET; keep the health semantics you test for.
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

export async function POST(req: NextRequest) {
  try {
    const {
      toEmail,
      subject,
      text,
      html,
      inReplyTo,
      dryRun,
    }: {
      toEmail?: string;
      subject?: string;
      text?: string;
      html?: string;
      inReplyTo?: string | null;
      dryRun?: boolean;
    } = await req.json();

    if (!toEmail || !subject) {
      return NextResponse.json(
        { ok: false, error: "missing_to_or_subject" },
        { status: 400 }
      );
    }

    // Accept html OR text; if only text is provided, wrap it as HTML.
    const htmlBody =
      (html && typeof html === "string" && html.trim().length > 0)
        ? html
        : (text && typeof text === "string" && text.trim().length > 0)
          ? wrapTextAsHtml(text)
          : "";

    if (!htmlBody) {
      // Old error was "missing_html" — keep compatibility but more forgiving now.
      return NextResponse.json(
        { ok: false, error: "missing_html_or_text" },
        { status: 400 }
      );
    }

    // Dry-run short circuit
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        status: 202,
        mode: "dry",
        to: toEmail,
        subject,
        result: "sent",
      });
    }

    await sendViaGraph({
      to: toEmail,
      subject,
      html: htmlBody,
      inReplyTo: inReplyTo ?? null,
    });

    return NextResponse.json({
      ok: true,
      status: 202,
      mode: "live",
      to: toEmail,
      subject,
      result: "sent",
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
