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
  const safe = escapeHtml(text || "");
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

/** Core create->(get)->send->(re-get)->(fallback list). Returns { ok, id, internetMessageId } or error info. */
async function createGetSend(opts: {
  accessToken: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string | null;
  includeHeaders: boolean;
}) {
  const { accessToken, from, to, subject, html, inReplyTo, includeHeaders } = opts;
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}`;

  const message: any = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };

  // Best-effort threading (some tenants block custom headers)
  if (includeHeaders && inReplyTo && String(inReplyTo).trim()) {
    const irt = String(inReplyTo).trim();
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
    return { ok: false as const, stage: "create", status: createResp.status, text: (await createResp.text()).slice(0, 2000) };
  }
  const created = (await createResp.json()) as { id: string };
  const id = created?.id;
  if (!id) return { ok: false as const, stage: "create", status: 500, text: "No id from create" };

  // 2) Try to read internetMessageId (non-fatal, often empty pre-send)
  let internetMessageId: string | undefined;
  try {
    const getResp = await fetch(
      `${base}/messages/${encodeURIComponent(id)}?$select=id,internetMessageId`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (getResp.ok) {
      const j = (await getResp.json()) as { id: string; internetMessageId?: string };
      internetMessageId = j?.internetMessageId;
    }
  } catch {}

  // 3) Send
  const sendResp = await fetch(`${base}/messages/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!sendResp.ok) {
    return {
      ok: false as const,
      stage: "send",
      status: sendResp.status,
      text: (await sendResp.text()).slice(0, 2000),
      id,
      internetMessageId,
    };
  }

  // 4) Re-check the same message now that it’s sent (many tenants populate after send)
  try {
    const reget = await fetch(
      `${base}/messages/${encodeURIComponent(id)}?$select=id,internetMessageId`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );
    if (reget.ok) {
      const jj = (await reget.json()) as { id: string; internetMessageId?: string };
      if (jj?.internetMessageId) internetMessageId = jj.internetMessageId;
    }
  } catch {}

  // 5) Fallback: ask Sent Items for the latest message’s internetMessageId
  if (!internetMessageId) {
    try {
      const listUrl =
        `${base}/mailFolders('sentitems')/messages?$top=1&$orderby=sentDateTime desc` +
        `&$select=id,internetMessageId,sentDateTime`;
      const meta = await fetch(listUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (meta.ok) {
        const j = await meta.json().catch(() => ({}));
        const first = j?.value?.[0];
        if (first?.internetMessageId) {
          internetMessageId = String(first.internetMessageId);
        }
      }
    } catch {}
  }

  return { ok: true as const, id, internetMessageId };
}

/** Auto-retry wrapper: try with headers; on 4xx/5xx, retry once without. */
async function sendViaGraphInstrumented({
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
  const from = requireEnv("MS_MAILBOX_FROM");

  const try1 = await createGetSend({
    accessToken,
    from,
    to,
    subject,
    html,
    inReplyTo: inReplyTo ?? null,
    includeHeaders: !!inReplyTo,
  });

  if (try1.ok) {
    return { id: try1.id!, internetMessageId: try1.internetMessageId || null };
  }

  if (inReplyTo && (try1.status >= 400 && try1.status <= 599)) {
    console.warn("[msgraph] retrying without headers", { stage: try1.stage, status: try1.status });
    const try2 = await createGetSend({
      accessToken,
      from,
      to,
      subject,
      html,
      inReplyTo: null,
      includeHeaders: false,
    });
    if (try2.ok) {
      return { id: try2.id!, internetMessageId: try2.internetMessageId || null };
    }
    throw new Error(
      `Graph send failed after retry (stage=${try2.stage} status=${try2.status}). First error: [${try1.stage} ${try1.status}] ${try1.text}`
    );
  }

  throw new Error(`Graph send error (stage=${try1.stage} status=${try1.status}): ${try1.text}`);
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
      return NextResponse.json({ ok: false, error: "missing_to_or_subject" }, { status: 400 });
    }

    // Accept html OR text; if only text is provided, wrap to HTML.
    const htmlBody =
      (html && typeof html === "string" && html.trim().length > 0)
        ? html
        : (text && typeof text === "string" && text.trim().length > 0)
          ? wrapTextAsHtml(text)
          : "";

    if (!htmlBody) {
      return NextResponse.json({ ok: false, error: "missing_html_or_text" }, { status: 400 });
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, status: 202, mode: "dry", to: toEmail, subject, result: "sent" });
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
      internetMessageId,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
