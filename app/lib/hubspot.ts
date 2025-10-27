// app/lib/hubspot.ts
type TokenSource = "env" | "refresh-endpoint";

/**
 * Attempts to get a HubSpot access token either from ENV
 * or by calling your existing refresh endpoint.
 */
export async function getHubSpotAccessToken(): Promise<string> {
  // 1) Prefer ENV fallback if present
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    return process.env.HUBSPOT_ACCESS_TOKEN!;
  }

  // 2) Otherwise try your refresh endpoint
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_BASE_URL not set, cannot refresh HubSpot token.");

  const res = await fetch(`${base}/api/hubspot/refresh`, { cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Token refresh failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  // Expect: { ok: true, access_token: "..." } or { token: "..." }
  const token = json.access_token ?? json.token;
  if (!token) throw new Error("Refresh endpoint did not return access token.");
  return token;
}

/**
 * GET JSON from HubSpot API
 */
export async function hubspotGet<T = any>(path: string, token: string): Promise<T> {
  const url = `https://api.hubapi.com${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HubSpot GET ${path} failed: ${res.status} ${t}`);
  }
  return res.json() as Promise<T>;
}

export function pickLastInboundEmailMessage(messagesPayload: any): {
  customerEmail: string | null;
  subject: string | null;
  messageId: string | null;
} {
  // Shape differs per account; be defensive.
  let results: any[] = messagesPayload?.results ?? messagesPayload ?? [];
  // Prefer newest last
  // Filter incoming email messages
  const inbound = results.filter((m) => {
    const isIncoming =
      (m?.direction || m?.channel?.direction || "").toString().toUpperCase().includes("IN");
    const isEmail =
      (m?.channel || m?.type || m?.messageType || "").toString().toUpperCase().includes("EMAIL") ||
      (m?.origin || "").toString().toUpperCase().includes("EMAIL");
    return isIncoming && isEmail;
  });

  const last = inbound.at(-1) ?? results.at(-1);
  if (!last) return { customerEmail: null, subject: null, messageId: null };

  // Try several shapes for headers and fields
  const subject =
    last.subject ??
    last?.emailSubject ??
    last?.metadata?.subject ??
    last?.message?.subject ??
    null;

  const customerEmail =
    last?.from?.email ??
    last?.sender?.email ??
    last?.metadata?.from?.email ??
    last?.message?.from?.email ??
    null;

  // Message-ID can be in headers
  const headers =
    last?.headers ??
    last?.metadata?.headers ??
    last?.message?.headers ??
    last?.emailHeaders ??
    null;

  let messageId: string | null = null;
  if (headers) {
    const keys = Object.keys(headers);
    const msgKey = keys.find((k) => k.toLowerCase() === "message-id" || k.toLowerCase() === "messageid");
    if (msgKey) messageId = headers[msgKey];
  }

  // Sometimes HubSpot exposes "internetMessageId" style
  if (!messageId) {
    messageId =
      last?.internetMessageId ??
      last?.metadata?.internetMessageId ??
      last?.message?.internetMessageId ??
      null;
  }

  return { customerEmail, subject, messageId };
}
