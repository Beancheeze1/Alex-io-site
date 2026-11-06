// lib/sales-mail.ts
//
// Step 48: send an internal sales email (to Alex-IO, never to a buyer)
// through Microsoft Graph, the same way app/api/demo-lead/route.ts does.
// Env: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_MAILBOX_FROM.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getGraphToken(): Promise<string> {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Error(`Graph token error ${r.status}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

export async function sendSalesEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const from = requireEnv("MS_MAILBOX_FROM");
  const token = await getGraphToken();
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}`;
  // Same two calls as app/api/demo-lead/route.ts (create the message, then send it).
  const createRes = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: opts.subject,
      body: { contentType: "HTML", content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    }),
  });
  if (!createRes.ok) throw new Error(`Graph create draft error ${createRes.status}`);
  const draft = (await createRes.json()) as { id: string };
  const sendRes = await fetch(`${base}/messages/${encodeURIComponent(draft.id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!sendRes.ok) throw new Error(`Graph send error ${sendRes.status}`);
}
