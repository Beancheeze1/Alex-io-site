// app/api/responder/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CartItem = { sku: string; qty: number };

async function getAccessTokenFromKv(): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent("hubspot:access_token")}`, {
    headers: { Authorization: `Bearer ${tok}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const js = await r.json().catch(() => null) as { result?: string } | null;
  return js?.result ?? null;
}

async function getThread(token: string, threadId: string) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`thread fetch ${r.status}: ${t || r.statusText}`);
  }
  return r.json();
}

async function postToHubSpotThread(threadId: string, text: string) {
  const token = await getAccessTokenFromKv();
  if (!token) return { ok: false, status: 401, error: "No HubSpot access token in KV" };

  // 1) Fetch thread to get channel context
  const thread = await getThread(token, threadId).catch((e) => ({ error: String(e) }));
  if ((thread as any).error) return { ok: false, status: 400, error: (thread as any).error };

  // Try multiple places HubSpot puts these fields
  const channelId =
    (thread as any).channelId ??
    (Array.isArray((thread as any).threadMessages) && (thread as any).threadMessages[0]?.channelId) ??
    undefined;

  const channelAccountId =
    (thread as any).channelAccountId ??
    (Array.isArray((thread as any).threadMessages) && (thread as any).threadMessages[0]?.channelAccountId) ??
    undefined;

  // 2) Build payload with required fields
  const payload: Record<string, any> = {
    type: "MESSAGE",
    text,
    richText: false,
    senderType: "AGENT",
    messageDirection: "OUTGOING",
  };

  if (channelId) payload.channelId = channelId;
  if (channelAccountId) payload.channelAccountId = channelAccountId;

  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(
    threadId
  )}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false as const, status: res.status, error: detail || res.statusText, payload, thread };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true as const, status: 200, data, payload };
}


function fmtMoney(n: number, ccy = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(n);
}

function composeReply(payload: any) {
  const { lines = [], subtotal, tax, total, currency = "USD", lead_days } = payload;

  const bullets = lines
    .map(
      (l: any) =>
        `• ${l.qty} × ${l.name} (${l.sku}) — ${fmtMoney(l.unit_price, currency)} ea = ${fmtMoney(
          l.line_total,
          currency
        )}`
    )
    .join("\n");

  const lead = Number(lead_days) > 0 ? `Estimated lead time is ~${lead_days} business days.` : "";
  const footer =
    "If this looks good, reply here and I’ll finalize the quote and next steps.";

  const txt = [
    "Thanks for reaching out — here’s a quick quote:",
    "",
    bullets,
    "",
    `Subtotal: ${fmtMoney(subtotal, currency)}`,
    `Tax: ${fmtMoney(tax, currency)}`,
    `Total: ${fmtMoney(total, currency)}`,
    "",
    lead,
    footer,
  ]
    .filter(Boolean)
    .join("\n");

  return txt;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      threadId?: string;
      items?: CartItem[];
      currency?: string;
      taxRate?: number;
      save?: boolean;
      send?: boolean; // default false → dry run
    };

    const { threadId, items, currency = "USD", taxRate = 0, save = false, send = false } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "items[] required: [{ sku, qty }]" },
        { status: 400 }
      );
    }

    // Call your own Quote API (same origin)
    const origin = process.env.APP_BASE_URL || new URL(req.url).origin;
    const qRes = await fetch(`${origin}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ items, currency, taxRate, save }),
    });

    const quote = await qRes.json().catch(() => ({}));
    if (!qRes.ok || !quote?.ok) {
      return NextResponse.json(
        { ok: false, step: "quote", status: qRes.status, quote },
        { status: 502 }
      );
    }

    const message = composeReply(quote);

    if (!send) {
      // Dry run: return what we WOULD send
      return NextResponse.json({
        ok: true,
        dryRun: true,
        message,
        quote,
      });
    }

    if (!threadId) {
      return NextResponse.json(
        { ok: false, error: "threadId required when send=true" },
        { status: 400 }
      );
    }

    const post = await postToHubSpotThread(threadId, message);
    if (!post.ok) {
      return NextResponse.json(
        { ok: false, step: "hubspot", status: post.status, error: post.error },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      hubspot: post.data ?? null,
      quote,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
