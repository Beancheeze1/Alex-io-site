// app/lib/hubspot.ts
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

/** Normalize HubSpot test/live payloads into {toEmail, text, subject, messageId}. */
export function parseHubspotPayload(raw: unknown): ParsedInbound {
  const payload: HSArrive | undefined = first(raw as any);
  if (!payload || typeof payload !== "object") return {};

  const msg = (payload as any).message ?? {};
  const from = (msg as any).from ?? {};

  const toEmail =
    (from?.email as string | undefined) ??
    ((payload as any)?.fromEmail as string | undefined);

  const text =
    (msg?.text as string | undefined) ??
    ((payload as any)?.text as string | undefined);

  const subject =
    (msg?.subject as string | undefined) ??
    ((payload as any)?.subject as string | undefined);

  const messageId =
    (payload as any)?.messageId ??
    (payload as any)?.headers?.["Message-Id"] ??
    (payload as any)?.headers?.["Message-ID"];

  return { toEmail, text, subject, messageId };
}
