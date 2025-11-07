// app/api/msgraph/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- helpers (inline to avoid imports) ---
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

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`token_error ${res.status}: ${t}`);
  }
  const j = await res.json();
  return j.access_token as string;
}

function normalizeMsgId(id: string) {
  const s = (id || "").trim();
  if (!s) return "";
  // If it's already <...>, keep it; otherwise, wrap if it looks like an email-style id
  if (s.startsWith("<") && s.endsWith(">")) return s;
  if (s.includes("@")) return `<${s}>`;
  return s; // let Graph fail if not valid; we’ll report cleanly
}

function escOdataLiteral(v: string) {
  // OData string literal uses single quotes; escape by doubling them.
  return v.replace(/'/g, "''");
}

async function lookupByInternetMessageId(mailbox: string, internetMessageId: string, token: string) {
  const idNorm = normalizeMsgId(internetMessageId);
  const idEsc = escOdataLiteral(idNorm);
  const url =
    `https://graph.microsoft.com/v1.0/users/` +
    `${encodeURIComponent(mailbox)}` +
    `/messages?$filter=internetMessageId eq '${idEsc}'` +
    `&$top=1&$select=id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,replyTo`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore parse */ }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: "graph_lookup_failed",
      detail: data ?? text ?? null,
    };
  }

  const value = Array.isArray(data?.value) ? data.value : [];
  const first = value[0] ?? null;

  return {
    ok: true,
    found: !!first,
    count: value.length,
    record: first
      ? {
          id: first.id,
          internetMessageId: first.internetMessageId,
          conversationId: first.conversationId,
          subject: first.subject,
          receivedDateTime: first.receivedDateTime,
          from: first.from,
          toRecipients: first.toRecipients,
          replyTo: first.replyTo,
        }
      : null,
  };
}

// --- route handlers ---
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mailbox = process.env.MS_MAILBOX_FROM || requireEnv("MS_MAILBOX_FROM");
    const internetMessageId = (searchParams.get("id") || "").trim();
    if (!internetMessageId) {
      return NextResponse.json({ ok: false, error: "missing id query param" }, { status: 400 });
    }
    const token = await getAppToken();
    const result = await lookupByInternetMessageId(mailbox, internetMessageId, token);
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const mailbox = process.env.MS_MAILBOX_FROM || requireEnv("MS_MAILBOX_FROM");
    const body = await req.json().catch(() => ({}));
    const internetMessageId = String(body?.internetMessageId ?? "").trim();
    if (!internetMessageId) {
      return NextResponse.json({ ok: false, error: "internetMessageId required" }, { status: 400 });
    }
    const token = await getAppToken();
    const result = await lookupByInternetMessageId(mailbox, internetMessageId, token);
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}
