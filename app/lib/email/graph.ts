// app/lib/email/graph.ts
/**
 * Minimal Graph "send as raw MIME" helper.
 * Uses client-credentials. Requires mailbox send-as permissions for app.
 */
export async function sendRawMimeViaGraph(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;            // e.g., "sales@alex-io.com"
  rawMime: string;         // full RFC822 message with headers + body
}): Promise<{ ok: boolean; status: number; error?: any }> {
  const { tenantId, clientId, clientSecret, from, rawMime } = params;

  // 1) App-only token for Graph
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
    const t = await tokenRes.text().catch(() => "");
    return { ok: false, status: tokenRes.status, error: `TokenError: ${t}` };
  }
  const tokenJson: any = await tokenRes.json();
  const accessToken = tokenJson.access_token as string;

  // 2) Create empty draft
  const draftRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );

  if (!draftRes.ok) {
    const t = await draftRes.text().catch(() => "");
    return { ok: false, status: draftRes.status, error: `CreateDraftError: ${t}` };
  }
  const draft = await draftRes.json();

  // 3) Upload MIME to the draft
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/messages/${draft.id}/$value`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "message/rfc822",
      },
      body: rawMime,
    }
  );
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => "");
    return { ok: false, status: uploadRes.status, error: `UploadMimeError: ${t}` };
  }

  // 4) Send the draft
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/messages/${draft.id}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!sendRes.ok) {
    const t = await sendRes.text().catch(() => "");
    return { ok: false, status: sendRes.status, error: `SendError: ${t}` };
  }

  return { ok: true, status: 202 };
}
