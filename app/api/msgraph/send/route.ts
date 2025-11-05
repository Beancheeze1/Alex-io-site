// app/api/msgraph/send/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAppToken() {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("grant_type", "client_credentials");
  form.set("scope", "https://graph.microsoft.com/.default");

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`token_failed ${res.status} ${t}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

type SendBody = {
  to: string;
  subject: string;
  html: string;
  // if provided, we will reply-in-thread
  inReplyTo?: string | null;           // Internet-Message-ID (e.g., "<ABC123@outlook.com>")
  threadId?: string | number | null;   // optional (info only)
  internetMessageId?: string | null;   // alias; if set, used as inReplyTo
};

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/msgraph/send" });
}

export async function POST(req: NextRequest) {
  try {
    const from = requireEnv("MS_MAILBOX_FROM"); // e.g. sales@alex-io.com
    const accessToken = await getAppToken();
    const body = (await req.json().catch(() => ({}))) as SendBody;

    if (!body?.to || !body?.subject || !body?.html) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    // choose best hint for reply-in-thread
    const inReplyTo = (body.internetMessageId ?? body.inReplyTo ?? "").trim();

    // Small helper for Graph calls
    const g = async (path: string, init?: RequestInit) => {
      const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
      return res;
    };

    // If we have an Internet-Message-ID, try true reply flow:
    if (inReplyTo) {
      // The value sometimes includes <...>; strip angle brackets for filter match
      const trimmed = inReplyTo.replace(/^<|>$/g, "");

      // 1) Find the original message by internetMessageId
      //    NOTE: property is filterable; wrap value in single quotes
      const searchRes = await g(
        `/users/${encodeURIComponent(
          from
        )}/messages?$filter=internetMessageId eq '${trimmed.replace(/'/g, "''")}'&$select=id,conversationId`
      );

      if (!searchRes.ok) {
        const t = await searchRes.text().catch(() => "");
        // fall back to new send
        return await sendNew(g, from, body, {
          note: `lookup_failed_${searchRes.status}`,
          detail: t,
        });
      }

      const found = (await searchRes.json()) as { value?: Array<{ id: string }> };
      const originalId = found?.value?.[0]?.id;

      if (originalId) {
        // 2) Create a reply draft
        const createReplyRes = await g(
          `/users/${encodeURIComponent(from)}/messages/${originalId}/createReply`,
          { method: "POST" }
        );
        if (!createReplyRes.ok) {
          const t = await createReplyRes.text().catch(() => "");
          return await sendNew(g, from, body, {
            note: `createReply_failed_${createReplyRes.status}`,
            detail: t,
          });
        }
        const draft = (await createReplyRes.json()) as { id: string };

        // 3) Update the draft body (HTML) and recipients (ensure 'to' specified)
        const patchRes = await g(`/users/${encodeURIComponent(from)}/messages/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            body: { contentType: "HTML", content: body.html },
            toRecipients: [
              {
                emailAddress: { address: body.to },
              },
            ],
          }),
        });
        if (!patchRes.ok) {
          const t = await patchRes.text().catch(() => "");
          return await sendNew(g, from, body, {
            note: `patch_reply_failed_${patchRes.status}`,
            detail: t,
          });
        }

        // 4) Send the reply draft
        const sendRes = await g(`/users/${encodeURIComponent(from)}/messages/${draft.id}/send`, {
          method: "POST",
        });
        if (!sendRes.ok) {
          const t = await sendRes.text().catch(() => "");
          return NextResponse.json(
            {
              ok: false,
              error: "reply_send_failed",
              status: sendRes.status,
              detail: t,
              mode: "reply_in_thread",
            },
            { status: 500 }
          );
        }

        return NextResponse.json({
          ok: true,
          status: 200,
          mode: "reply_in_thread",
          to: body.to,
          subject: body.subject,
        });
      }

      // Not found → fall back to new send
      return await sendNew(g, from, body, { note: "reply_target_not_found" });
    }

    // No inReplyTo provided → new message
    return await sendNew(g, from, body);

  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "send_exception" },
      { status: 500 }
    );
  }
}

// helper: normal new send
async function sendNew(
  g: (path: string, init?: RequestInit) => Promise<Response>,
  from: string,
  body: SendBody,
  meta?: Record<string, any>
) {
  const newRes = await g(`/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: body.subject,
        body: { contentType: "HTML", content: body.html },
        toRecipients: [{ emailAddress: { address: body.to } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!newRes.ok) {
    const t = await newRes.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: "send_failed", status: newRes.status, detail: t, mode: "sendMail_fallback", ...(meta || {}) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: newRes.status,
    mode: "sendMail_fallback",
    to: body.to,
    subject: body.subject,
    ...(meta || {}),
  });
}
