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

/**
 * Instrumented send:
 * 1) POST /users/{from}/messages   -> create draft (optionally inject headers)
 * 2) GET  /users/{from}/messages/{id} -> fetch internetMessageId
 * 3) POST /users/{from}/messages/{id}/send -> send
 * Returns: { id, internetMessageId }
 */
async function sendViaGraphInstrumented(opts: {
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string | null;
}) {
  const accessToken = await getAppToken();
  const from = requireEnv("MS_MAILBOX_FROM"); // e.g., sales@alex-io.com
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}`;

  // Build message body
  const message: any = {
    subject: opts.subject,
    body: { contentType: "HTML", content: opts.html },
    toRecipients: [{ emailAddress: { address: opts.to } }],
  };

  // Best-effort threading hints (will be ignored if not allowed)
  const irt = String(opts.inReplyTo ?? "").trim();
  if (irt) {
    // Many tenants accept custom headers on create; safe to include.
    message.internetMessageHeaders = [
      { name: "In-Reply-To", value: irt },
      { name: "References", value: irt },
    ];
  }

  // 1) Create draft
  const createResp = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!createResp.ok) {
    const t = await createResp.text();
    throw new Error(`Graph create message error ${createResp.status}: ${t}`);
  }

  const created = (await createResp.json()) as { id: string };
  const createdId = created?.id;
  if (!createdId) throw new Error("Graph create message did not return an id");

  // 2) Look up internetMessageId (read-only; useful for threading & NDR correlation)
  let internetMessageId: string | undefined = undefined;
  try {
    const getResp = await fetch(
      `${base}/messages/${encodeURIComponent(createdId)}?$select=id,internetMessageId`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (getResp.ok) {
      const j = (await getResp.json()) as { id: string; internetMessageId?: string };
      internetMessageId = j?.internetMessageId;
    }
  } catch {
    // non-fatal
  }

  // 3) Send
  const sendResp = await fetch(`${base}/messages/${encodeURIComponent(createdId)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!sendResp.ok) {
    const t = await sendResp.text();
    throw new Error(`Graph send error ${sendResp.status}: ${t}`);
  }

  return { id: createdId, internetMessageId };
}

// --- handlers ---
export async function GET() {
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

    const { id, internetMessageId } = await sendViaGraphInstrumented({
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
      messageId: id,
      internetMessageId: internetMessageId || null,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
