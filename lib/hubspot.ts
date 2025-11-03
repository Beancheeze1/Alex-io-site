// app/lib/hubspot.ts
//
// Lightweight helpers for HubSpot webhook payloads (conversation.newMessage)

export type HSArrive = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string;
  messageId?: string;
  message?: {
    from?: { email?: string };
    text?: string;
    subject?: string;
  };
  // HubSpot can also send "objectId" etc.; we only pull what we need
};

export type ParsedInbound = {
  toEmail?: string;
  text?: string;
  subject?: string;
  messageId?: string;
};

function first<T>(x: T | T[] | undefined): T | undefined {
  if (!x) return undefined;
  return Array.isArray(x) ? x[0] : x;
}

/**
 * Accepts HubSpot test payloads (object or array) and live payloads,
 * and normalizes out { toEmail, text, subject, messageId }.
 */
export function parseHubspotPayload(raw: unknown): ParsedInbound {
  // HubSpot test UI sometimes posts an array of 1
  const payload: HSArrive | undefined = first(raw as any);

  if (!payload || typeof payload !== "object") return {};

  const msg = (payload as HSArrive).message ?? (payload as any).message ?? {};
  const from = (msg as any).from ?? {};

  const toEmail =
    (from?.email as string | undefined) ??
    // fallback: alternate shapes folks have seen in tests
    ((payload as any)?.fromEmail as string | undefined);

  const text =
    (msg?.text as string | undefined) ??
    ((payload as any)?.text as string | undefined);

  const subject =
    (msg?.subject as string | undefined) ??
    ((payload as any)?.subject as string | undefined);

  const messageId =
    ((payload as HSArrive).messageId as string | undefined) ??
    ((payload as any)?.headers?.["Message-Id"] as string | undefined) ??
    ((payload as any)?.headers?.["Message-ID"] as string | undefined);

  return { toEmail, text, subject, messageId };
}
