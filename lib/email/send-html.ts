// lib/email/send-html.ts
//
// Send one HTML email through Microsoft Graph (client credentials), using the
// same env vars as app/api/demo-lead: MS_TENANT_ID, MS_CLIENT_ID,
// MS_CLIENT_SECRET, MS_MAILBOX_FROM.
// Never throws: returns { ok: false, error } so callers can record the failure.

export type SendResult = { ok: true } | { ok: false; error: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendHtmlEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
}): Promise<SendResult> {
  try {
    const tenant = process.env.MS_TENANT_ID;
    const clientId = process.env.MS_CLIENT_ID;
    const clientSecret = process.env.MS_CLIENT_SECRET;
    const from = process.env.MS_MAILBOX_FROM;
    if (!tenant || !clientId || !clientSecret || !from) {
      return { ok: false, error: "missing_env: MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_MAILBOX_FROM" };
    }

    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });
    if (!tokenRes.ok) {
      return { ok: false, error: `graph_token_${tokenRes.status}: ${(await tokenRes.text().catch(() => "")).slice(0, 300)}` };
    }
    const token = ((await tokenRes.json()) as { access_token: string }).access_token;

    const message: Record<string, unknown> = {
      subject: opts.subject.slice(0, 250),
      body: { contentType: "HTML", content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    };
    if (opts.replyTo) message.replyTo = [{ emailAddress: { address: opts.replyTo } }];

    const sendRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message, saveToSentItems: true }),
      },
    );
    if (!sendRes.ok) {
      return { ok: false, error: `graph_send_${sendRes.status}: ${(await sendRes.text().catch(() => "")).slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `exception: ${String(err?.message || err).slice(0, 300)}` };
  }
}
