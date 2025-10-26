// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookEvent = {
  subscriptionType?: string;
  objectId?: number | string;
  eventId?: number | string;
  portalId?: number | string;
  messageId?: string;
  occurredAt?: number;
  [k: string]: unknown;
};

const FP = "webhook-v3";
const KEY_EVENTS = "hs:webhook:events";
const MAX_EVENTS = 200;

function log(...args: any[]) {
  if (process.env.LOG_WEBHOOK === "1") console.log("[WEBHOOK]", ...args);
}

// Minimal KV shim (prefers "@/lib/kv", falls back to memory)
type KV = {
  lpush: (key: string, value: string) => Promise<number>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  llen: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  get?: (key: string) => Promise<string | null>;
  set?: (key: string, val: string) => Promise<unknown>;
};

const memoryStore: { events: string[] } = { events: [] };
const memoryKV: KV = {
  async lpush(_k, v) { memoryStore.events.unshift(v); if (memoryStore.events.length > MAX_EVENTS) memoryStore.events.length = MAX_EVENTS; return memoryStore.events.length; },
  async lrange(_k, s, e) { const end = e === -1 ? memoryStore.events.length : e + 1; return memoryStore.events.slice(s, end); },
  async llen() { return memoryStore.events.length; },
  async del() { const n = memoryStore.events.length; memoryStore.events = []; return n; },
  async get() { return null; },
  async set() { return true; },
};

async function getKV(): Promise<KV> {
  try {
    const mod: any = await import("@/lib/kv");
    const candidate = mod?.kv ?? mod?.default ?? mod?.redis ?? mod?.client ?? mod;
    if (candidate?.lpush && candidate?.lrange && candidate?.llen && candidate?.del) return candidate as KV;

    if (candidate?.get || candidate?.set) {
      const c = candidate;
      const adapted: KV = {
        async lpush(k: string, v: string) {
          const cur = (await c.get(k)) as string | null;
          const arr: string[] = cur ? JSON.parse(cur) : [];
          arr.unshift(v); await c.set(k, JSON.stringify(arr)); return arr.length;
        },
        async lrange(k: string, s: number, e: number) {
          const cur = (await c.get(k)) as string | null;
          const arr: string[] = cur ? JSON.parse(cur) : [];
          const end = e === -1 ? arr.length : e + 1;
          return arr.slice(s, end);
        },
        async llen(k: string) {
          const cur = (await c.get(k)) as string | null;
          const arr: string[] = cur ? JSON.parse(cur) : [];
          return arr.length;
        },
        async del(k: string) {
          if (typeof c.del === "function") return c.del(k);
          await c.set(k, JSON.stringify([])); return 1;
        },
        get: c.get?.bind(c),
        set: c.set?.bind(c),
      };
      return adapted;
    }
  } catch {}
  return memoryKV;
}

// ---------- GET admin ----------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const search = url.searchParams;
  const kv = await getKV();

  if (search.has("dryRun")) {
    return NextResponse.json({
      ok: true,
      note: "GET modes: ?dryRun=1 | ?mode=recent&limit=10 | ?mode=count | ?mode=replay&id=0 | ?mode=clear",
      fp: FP,
    });
  }

  const mode = search.get("mode");
  if (!mode) {
    return NextResponse.json({
      ok: true,
      note: "GET modes: ?dryRun=1 | ?mode=recent&limit=10 | ?mode=count | ?mode=replay&id=0 | ?mode=clear",
      fp: FP,
    });
  }

  switch (mode) {
    case "count": {
      const n = await kv.llen(KEY_EVENTS);
      return NextResponse.json({ ok: true, count: n, fp: FP });
    }
    case "recent": {
      const limit = Math.max(1, Math.min(100, Number(search.get("limit") ?? 10)));
      const rows = await kv.lrange(KEY_EVENTS, 0, limit - 1);
      const events = rows.map((r) => JSON.parse(r));
      return NextResponse.json({ ok: true, limit, events, fp: FP });
    }
    case "replay": {
      const id = Number(search.get("id") ?? 0);
      const rows = await kv.lrange(KEY_EVENTS, 0, MAX_EVENTS - 1);
      if (rows.length === 0 || id < 0 || id >= rows.length) {
        return NextResponse.json({ ok: false, error: "no-event", fp: FP }, { status: 404 });
      }

      // Unwrap storage format { ts, ev } → WebhookEvent
      const parsed: any = JSON.parse(rows[id]);
      const event: WebhookEvent = parsed?.ev ?? parsed;
      log("replay", { id, evt: event });

      const res = await attemptReply(event);
      return NextResponse.json({ ok: true, replayed: id, reply: res, fp: FP });
    }
    case "clear": {
      await kv.del(KEY_EVENTS);
      return NextResponse.json({ ok: true, cleared: true, fp: FP });
    }
    default:
      return NextResponse.json({ ok: false, error: "bad-mode", fp: FP }, { status: 400 });
  }
}

// ---------- POST webhook ----------
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    let arr: unknown;
    try { arr = JSON.parse(raw); } catch {
      log("invalid-json", raw?.slice?.(0, 256) ?? "<non-string>");
      return NextResponse.json({ ok: false, error: "invalid-json", fp: FP }, { status: 400 });
    }
    if (!Array.isArray(arr)) {
      return NextResponse.json({ ok: false, error: "expected-array", fp: FP }, { status: 400 });
    }

    const events = (arr as WebhookEvent[]).filter(Boolean);
    const kv = await getKV();

    let recorded = 0;
    for (const ev of events) {
      const stored = { ts: Date.now(), ev };
      await kv.lpush(KEY_EVENTS, JSON.stringify(stored));
      recorded++;
    }

    log("received", { count: events.length });

    let replyResult: unknown = { skipped: true, reason: "reply-disabled" };
    if (process.env.REPLY_ENABLED === "1" && events.length > 0) {
      replyResult = await attemptReply(events[events.length - 1]);
    }

    return NextResponse.json({
      ok: true, recorded: true, received: events.length, note: "accepted", reply: replyResult, fp: FP,
    });
  } catch (err: any) {
    log("handler-error", err?.message ?? err);
    return NextResponse.json({ ok: false, error: "handler-failure", fp: FP }, { status: 500 });
  }
}

// ---------- Reply logic ----------
async function attemptReply(ev: WebhookEvent): Promise<unknown> {
  const threadIdOrConversationId = String(ev.objectId ?? "");
  if (!threadIdOrConversationId) return { ok: false, reason: "no-threadId" };

  const forwardUrl = process.env.REPLY_URL;
  if (forwardUrl) {
    try {
      const r = await fetch(forwardUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: threadIdOrConversationId, event: ev }),
      });
      const text = await r.text();
      try { return { ok: r.ok, status: r.status, body: JSON.parse(text) }; }
      catch { return { ok: r.ok, status: r.status, body: text }; }
    } catch (e: any) {
      return { ok: false, reason: "forward-failed", error: e?.message ?? String(e) };
    }
  }

  // Fallback: no forwarder configured – skip (recommended to use REPLY_URL).
  return { ok: false, reason: "no-forwarder" };
}
