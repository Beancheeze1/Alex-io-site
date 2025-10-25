// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookEvent = {
  subscriptionType?: string;
  objectId?: number | string; // HubSpot threadId in our flow
  eventId?: number | string;
  portalId?: number | string;
  messageId?: string;
  occurredAt?: number;
  [k: string]: unknown;
};

const FP = "webhook-v3";

// ---- Logging helper (guarded by env) ----
function log(...args: any[]) {
  if (process.env.LOG_WEBHOOK === "1") {
    console.log("[WEBHOOK]", ...args);
  }
}

// ---- Simple storage facade (prefers Redis via "@/lib/kv") ----
type KV = {
  lpush: (key: string, value: string) => Promise<number>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  llen: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  get?: (key: string) => Promise<string | null>;
  set?: (key: string, val: string) => Promise<unknown>;
};

const KEY_EVENTS = "hs:webhook:events";
const MAX_EVENTS = 200;

// In-memory fallback (kept minimal & safe for dev)
const memoryStore: { events: string[] } = { events: [] };

const memoryKV: KV = {
  async lpush(_key, value) {
    memoryStore.events.unshift(value);
    if (memoryStore.events.length > MAX_EVENTS) {
      memoryStore.events.length = MAX_EVENTS;
    }
    return memoryStore.events.length;
  },
  async lrange(_key, start, stop) {
    // emulate redis inclusive stop
    const end = stop === -1 ? memoryStore.events.length : stop + 1;
    return memoryStore.events.slice(start, end);
  },
  async llen(_key) {
    return memoryStore.events.length;
  },
  async del(_key) {
    const n = memoryStore.events.length;
    memoryStore.events = [];
    return n;
  },
  async get(_key) {
    return null;
  },
  async set(_key, _val) {
    return true;
  },
};

async function getKV(): Promise<KV> {
  // Try "@/lib/kv" but accept multiple export shapes without type errors.
  try {
    // Use 'any' so TypeScript doesn’t complain about unknown export shapes.
    const mod: any = await import("@/lib/kv");

    // Common patterns we’ve used across chats/projects:
    //  - named export:   export const kv = new Redis(...)
    //  - default export: export default new Redis(...)
    //  - other names:    export const redis/client = new Redis(...)
    const candidate =
      mod?.kv ??
      mod?.default ??
      mod?.redis ??
      mod?.client ??
      mod;

    // If it already looks like a Redis client with list ops, use it.
    if (
      candidate &&
      typeof candidate.lpush === "function" &&
      typeof candidate.lrange === "function" &&
      typeof candidate.llen === "function" &&
      typeof candidate.del === "function"
    ) {
      return candidate as KV;
    }

    // If it only has get/set, adapt it to the KV interface we need.
    if (candidate && (typeof candidate.get === "function" || typeof candidate.set === "function")) {
      const adapted: KV = {
        async lpush(key: string, value: string) {
          // emulate LPUSH as a JSON array prepend
          const cur = (await candidate.get(key)) as string | null;
          const arr: string[] = cur ? JSON.parse(cur) : [];
          arr.unshift(value);
          await candidate.set(key, JSON.stringify(arr));
          return arr.length;
        },
        async lrange(key: string, start: number, stop: number) {
          const cur = (await candidate.get(key)) as string | null;
          const arr: string[] = cur ? JSON.parse(cur) : [];
          const end = stop === -1 ? arr.length : stop + 1;
          return arr.slice(start, end);
        },
        async llen(key: string) {
          const cur = (await candidate.get(key)) as string | null;
          const arr: string[] = cur ? JSON.parse(cur) : [];
          return arr.length;
        },
        async del(key: string) {
          // if candidate has a real 'del', prefer it; else clear via set
          if (typeof candidate.del === "function") {
            return candidate.del(key);
          }
          await candidate.set(key, JSON.stringify([]));
          return 1;
        },
        get: candidate.get?.bind(candidate),
        set: candidate.set?.bind(candidate),
      };
      return adapted;
    }
  } catch {
    // fall through to memory
  }
  return memoryKV;
}


// ---- Admin GET modes ----
export async function GET(req: Request) {
  const url = new URL(req.url);
  const search = url.searchParams;

  if (search.has("dryRun")) {
    return NextResponse.json({
      ok: true,
      note:
        "GET modes: ?dryRun=1  |  ?mode=recent&limit=10  |  ?mode=count  |  ?mode=replay&id=0  |  ?mode=clear",
      fp: FP,
    });
  }

  const mode = search.get("mode");
  const kv = await getKV();

  if (!mode) {
    return NextResponse.json({
      ok: true,
      note:
        "GET modes: ?dryRun=1  |  ?mode=recent&limit=10  |  ?mode=count  |  ?mode=replay&id=0  |  ?mode=clear",
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
      const id = Number(search.get("id") ?? 0); // 0 = newest
      const rows = await kv.lrange(KEY_EVENTS, 0, MAX_EVENTS - 1);
      if (rows.length === 0 || id < 0 || id >= rows.length) {
        return NextResponse.json({ ok: false, error: "no-event", fp: FP }, { status: 404 });
      }
      const evt = JSON.parse(rows[id]) as WebhookEvent;
      log("replay", { id, evt });
      const res = await attemptReply(evt);
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

// ---- POST handler ----
export async function POST(req: Request) {
  try {
    // ensure JSON (handles file/--data-binary and raw bodies)
    const raw = await req.text();
    let arr: unknown;
    try {
      arr = JSON.parse(raw);
    } catch (_e) {
      log("invalid-json", raw?.slice?.(0, 256) ?? "<non-string>");
      return NextResponse.json({ ok: false, error: "invalid-json", fp: FP }, { status: 400 });
    }

    if (!Array.isArray(arr)) {
      return NextResponse.json({ ok: false, error: "expected-array", fp: FP }, { status: 400 });
    }

    const events = (arr as WebhookEvent[]).filter(Boolean);
    const kv = await getKV();

    // record all events
    let recorded = 0;
    for (const ev of events) {
      const stored = {
        ts: Date.now(),
        ev,
      };
      await kv.lpush(KEY_EVENTS, JSON.stringify(stored));
      recorded++;
    }

    // Optional logging
    log("received", { count: events.length });

    // Attempt a single reply for the newest event (typical in tests)
    let replyResult: unknown = { skipped: true, reason: "reply-disabled" };
    if (process.env.REPLY_ENABLED === "1" && events.length > 0) {
      replyResult = await attemptReply(events[events.length - 1]);
    }

    return NextResponse.json({
      ok: true,
      recorded: true,
      received: events.length,
      note: "accepted",
      reply: replyResult,
      fp: FP,
    });
  } catch (err: any) {
    log("handler-error", err?.message ?? err);
    return NextResponse.json({ ok: false, error: "handler-failure", fp: FP }, { status: 500 });
  }
}

// ---- Minimal reply attempt (toggle with REPLY_ENABLED=1) ----
async function attemptReply(ev: WebhookEvent): Promise<unknown> {
  // Resolve IDs (our past chain: objectId is threadId; conversationId may be absent)
  const threadId = String(ev.objectId ?? "");
  if (!threadId) {
    return { ok: false, reason: "no-threadId" };
  }

  // Strategy:
  // 1) If REPLY_URL is provided, forward the event there (internal responder)
  // 2) Else, if HS_TOKEN is present, do a minimal echo POST to HubSpot Conversations (best-effort)
  // 3) Else, skip with a clear reason

  // 1) Forward to an internal responder if configured
  const forwardUrl = process.env.REPLY_URL;
  if (forwardUrl) {
    try {
      const r = await fetch(forwardUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "hubspot.webhook", threadId, event: ev }),
      });
      const text = await r.text();
      return { ok: r.ok, status: r.status, body: safeJson(text) };
    } catch (e: any) {
      return { ok: false, reason: "forward-failed", error: e?.message ?? String(e) };
    }
  }

  // 2) Direct HubSpot attempt (best-effort; only if token present)
  const token = process.env.HS_TOKEN || (await tryGetTokenFromKV());
  if (!token) {
    return { ok: false, reason: "no-token" };
  }

  // Note: Endpoints evolve; this is a minimal placeholder.
  // If your established working responder uses a different endpoint, point REPLY_URL to it,
  // or replace this path with your known-good Conversations API call.
  const endpoint = `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(
    threadId
  )}/messages`;

  const payload = {
    type: "MESSAGE",
    text: "Alex-IO test responder: received your message ✅",
  };

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, body: safeJson(text) };
  } catch (e: any) {
    return { ok: false, reason: "hubspot-post-failed", error: e?.message ?? String(e) };
  }
}

// Try to fetch an OAuth token from KV if your project stores it there.
async function tryGetTokenFromKV(): Promise<string | null> {
  try {
    const kv = await getKV();
    // Adjust the key to match your project’s convention if different.
    const token = (await kv.get?.("hs:oauth:access_token")) ?? null;
    return token;
  } catch {
    return null;
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
