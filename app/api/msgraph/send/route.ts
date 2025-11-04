// app/api/msgraph/send/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function env(name: string, required = false) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}

async function getAppToken() {
  const tenant = env("MS_TENANT_ID", true);
  const clientId = env("MS_CLIENT_ID", true);
  const clientSecret = env("MS_CLIENT_SECRET", true);

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, { method: "POST", body });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(`token_fetch_failed ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token as string;
}

/**
 * If we receive an RFC5322 internetMessageId like "<xxxx@domain>",
 * try to resolve it to a Graph message id in the mailbox so we can /reply.
 */
async function resolveGraphMessageId(
  token: string,
  mailbox: string,
  internetMessageId?: string | null
): Promise<string | null> {
  if (!internetMessageId) return null;
  try {
    // Eq filter requires single quotes and exact match.
    const encoded = encodeURIComponent(internetMessageId);
    const url = `https://graph.microsoft.com/v1.0/users/${mailbox}/messages?$filter=internetMessageId eq '${encoded}'&$select=id,subject,conversationId,receivedDateTime,from`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({} as any));
    const id = j?.value?.[0]?.id as string | undefined;
    return id || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { to, subject, html, threadId, internetMessageId } = await req.json();

    const mailbox = env("MS_MAILBOX_FROM", true);
    const token = await getAppToken();

    // We support three threading hints (highest → lowest):
    //   1) graphMessageId (a real Graph message id, if caller ever supplies)
    //   2) internetMessageId (we resolve it)
    //   3) otherwise -> fallback to sendMail
    let graphMessageId: string | null = null;

    // Some callers might pass a Graph message id as "threadId" already.
    // Heuristic: Graph ids are usually long base64/opaque strings (contain '=' or very long).
    if (threadId && String(threadId).length > 20) {
      graphMessageId = String(threadId);
    }

    if (!graphMessageId && internetMessageId) {
      graphMessageId = await resolveGraphMessageId(token, mailbox, String(internetMessageId));
    }

    if (graphMessageId) {
      // Clean, in-thread reply; no quoted body.
      const endpoint = `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${encodeURIComponent(
        graphMessageId
      )}/reply`;
      const body = {
        comment: "",
        message: {
          internetMessageHeaders: [{ name: "X-AlexIO-Responder", value: "1" }],
          toRecipients: [{ emailAddress: { address: to } }],
          subject: subject || undefined,
          body: { contentType: "HTML", content: html || "" },
        },
      };

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.log("[graph-thread-check] reply_failed -> fallback", r.status, t.slice(0, 300));
      } else {
        console.log("[graph-thread-check] replied_in_thread", { to, graphMessageId });
        return NextResponse.json({ ok: true, mode: "reply_thread", to, graphMessageId });
      }
      // If reply failed (invalid/missing), fall through to sendMail below.
    } else {
      console.log("[graph-thread-check] no_thread_id -> fallback_sendMail", {
        hasThreadId: !!threadId,
        hasInternetMessageId: !!internetMessageId,
      });
    }

    // Fallback: sendMail (new thread) — always succeeds if token is valid
    const sendEndpoint = `https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`;
    const sendBody = {
      message: {
        subject: subject || "Re: your message",
        internetMessageHeaders: [{ name: "X-AlexIO-Responder", value: "1" }],
        body: { contentType: "HTML", content: html || "" },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    };

    const r2 = await fetch(sendEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(sendBody),
    });

    if (!r2.ok) {
      const t = await r2.text().catch(() => "");
      console.error("[msgraph] sendMail error", r2.status, t.slice(0, 300));
      return NextResponse.json({ ok: false, status: r2.status, detail: t, mode: "sendMail_error" }, { status: 200 });
    }
    return NextResponse.json({ ok: true, mode: "sendMail_fallback", to });
  } catch (e: any) {
    console.error("[msgraph] exception", e?.message || String(e));
    return NextResponse.json({ ok: false, error: e?.message || "msgraph_exception" }, { status: 500 });
  }
}
