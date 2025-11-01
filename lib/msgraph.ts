// lib/msgraph.ts
/**
 * Minimal Microsoft Graph mail helper.
 * Uses client credentials to call:
 *   POST https://graph.microsoft.com/v1.0/users/{from}/sendMail
 */

type MailArgs = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const TENANT   = () => env("MS_TENANT_ID");
const CLIENT   = () => env("MS_CLIENT_ID");
const SECRET   = () => env("MS_CLIENT_SECRET");
const FROM     = () => env("MS_MAILBOX_FROM"); // e.g., "sales@alex-io.com"

async function getAppToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT(),
    client_secret: SECRET(),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph token error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { access_token: string };
  if (!json?.access_token) throw new Error("Graph token missing access_token");
  return json.access_token;
}

/** Sends an email via Graph and returns the Graph response metadata. */
export async function sendGraphMail(args: MailArgs): Promise<{
  ok: boolean;
  status: number;
  requestId?: string | null;
}> {
  const token = await getAppToken();

  const message = {
    message: {
      subject: args.subject,
      body: {
        contentType: args.html ? "HTML" : "Text",
        content: args.html ?? args.text ?? "",
      },
      toRecipients: [{ emailAddress: { address: args.to } }],
      from: { emailAddress: { address: FROM() } },
      sender: { emailAddress: { address: FROM() } },
    },
    saveToSentItems: true,
  };

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    FROM()
  )}/sendMail`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  // Graph returns 202 on success (no body).
  const requestId = res.headers.get("request-id");
  return { ok: res.status === 202, status: res.status, requestId };
}
