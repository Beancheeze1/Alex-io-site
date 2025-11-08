// app/api/msgraph/send/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== Env & token helpers (inline: Path A, no imports) =====
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`token_error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.access_token as string;
}

function s(v: unknown) { return String(v ?? "").trim(); }
function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizeMsgId(id: string) {
  const t = s(id);
  if (!t) return "";
  if (t.startsWith("<") && t.endsWith(">")) return t;
  return t.includes("@") ? `<${t}>` : t;
}

function escOdataLiteral(v: string) { return v.replace(/'/g, "''"); }

// ===== Graph helpers =====
async function graphJson(method: string, url: string, token: string, body?: any) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore parse */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function lookupByInternetMessageId(mailbox: string, internetMessageId: string, token: string) {
  const idNorm = normalizeMsgId(internetMessageId);
  const idEsc = escOdataLiteral(idNorm);
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
    `/messages?$filter=internetMessageId eq '${idEsc}'&$top=1&$select=id,subject,internetMessageId,conversationId`;

  const r = await graphJson("GET", url, token);
  if (!r.ok) return { ok: false, status: r.status, error: "lookup_failed", detail: r.json ?? r.text };
  const value = Array.isArray(r.json?.value) ? r.json.value : [];
  const first = value[0];
  if (!first?.id) return { ok: true, found: false, status: 200, record: null };
  return { ok: true, found: true, status: 200, record: first };
}

async function createReplyDraft(mailbox: string, messageId: string, token: string) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}/createReply`;
  // comment is optional; send empty
  const r = await graphJson("POST", url, token, { comment: "" });
  if (!r.ok) return { ok: false, status: r.status, error: "create_reply_failed", detail: r.json ?? r.text };
  // createReply returns the draft message
  return { ok: true, status: 200, draft: r.json };
}

async function patchDraftHtml(mailbox: string, draftId: string, html: string, token: string) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${draftId}`;
  // Patch only the body
  const r = await graphJson("PATCH", url, token, {
    body: { contentType: "HTML", content: html },
  });
  if (!r.ok) return { ok: false, status: r.status, error: "patch_draft_failed", detail: r.json ?? r.text };
  return { ok: true, status: 200 };
}

async function sendDraft(mailbox: string, draftId: string, token: string) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${draftId}/send`;
  const r = await graphJson("POST", url, token, {});
  if (!r.ok) return { ok: false, status: r.status, error: "send_draft_failed", detail: r.json ?? r.text };
  return { ok: true, status: 202 };
}

async function sendNewMail(mailbox: string, to: string, subject: string, html: string, token: string) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
  const r = await graphJson("POST", url, token, {
    message: {
      subject,
      toRecipients: [{ emailAddress: { address: to } }],
      body: { contentType: "HTML", content: html },
    },
    saveToSentItems: true,
  });
  if (!r.ok) return { ok: false, status: r.status, error: "send_mail_failed", detail: r.json ?? r.text };
  return { ok: true, status: 202 };
}

// ===== Route =====
export async function POST(req: NextRequest) {
  try {
    const mailbox = process.env.MS_MAILBOX_FROM || requireEnv("MS_MAILBOX_FROM");
    const token = await getAppToken();

    const body = await req.json().catch(() => ({}));
    const to = s(body?.to ?? body?.toEmail);
    const subject = s(body?.subject || "Re: your message");
    const html = s(body?.html || "");
    const inReplyTo = s(body?.inReplyTo || body?.internetMessageId);
    const mode: "reply" | "new" = inReplyTo ? "reply" : "new";

    if (!isEmail(to)) {
      return NextResponse.json({ ok: false, status: 400, error: "invalid_to" }, { status: 200 });
    }
    if (!html) {
      return NextResponse.json({ ok: false, status: 400, error: "missing_html" }, { status: 200 });
    }

    if (mode === "reply") {
      // 1) find target
      const found = await lookupByInternetMessageId(mailbox, inReplyTo, token);
      if (!found.ok) {
        return NextResponse.json(
          { ok: false, mode: "reply", note: "graph_lookup_error", detail: found },
          { status: 200 }
        );
      }
      if (!found.found || !found.record?.id) {
        // graceful fallback to new mail
        const fallback = await sendNewMail(mailbox, to, subject, html, token);
        return NextResponse.json(
          {
            ok: fallback.ok,
            status: fallback.status,
            mode: "sendMail_fallback",
            note: "reply_target_not_found",
            to,
            subject,
            detail: fallback.ok ? undefined : fallback.detail,
          },
          { status: 200 }
        );
      }

      // 2) create reply draft
      const draft = await createReplyDraft(mailbox, found.record.id, token);
      if (!draft.ok) {
        return NextResponse.json(
          { ok: false, mode: "reply", note: "graph_create_reply_error", detail: draft },
          { status: 200 }
        );
      }
      const draftId = draft.draft?.id;
      if (!draftId) {
        return NextResponse.json(
          { ok: false, mode: "reply", note: "missing_draft_id", detail: draft },
          { status: 200 }
        );
      }

      // 3) patch body HTML
      const patched = await patchDraftHtml(mailbox, draftId, html, token);
      if (!patched.ok) {
        return NextResponse.json(
          { ok: false, mode: "reply", note: "graph_patch_error", detail: patched },
          { status: 200 }
        );
      }

      // 4) send draft
      const sent = await sendDraft(mailbox, draftId, token);
      return NextResponse.json(
        {
          ok: sent.ok,
          status: sent.status,
          mode: "reply",
          to,
          subject, // Graph will keep original threading/subject; included for logging symmetry
          result: sent.ok ? "sent" : sent.detail,
        },
        { status: 200 }
      );
    }

    // NEW MAIL
    const sent = await sendNewMail(mailbox, to, subject, html, token);
    return NextResponse.json(
      {
        ok: sent.ok,
        status: sent.status,
        mode: "new",
        to,
        subject,
        result: sent.ok ? "sent" : sent.detail,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, status: 500, error: e?.message || String(e) },
      { status: 200 } // soft for your admin chains
    );
  }
}
