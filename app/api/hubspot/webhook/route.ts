// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * HubSpot Webhook endpoint with Replay Logger
 *
 * POST:
 *   - ?dryRun=1     -> returns ok immediately, no parsing
 *   - (default)     -> expects JSON array of events; logs to Upstash list
 *
 * GET:
 *   - ?dryRun=1     -> health check JSON
 *   - ?mode=recent  -> returns last N logged entries (default N=10) from Upstash
 *   - ?mode=count   -> returns current log length
 *
 * Upstash keys:
 *   hubspot:webhook:log         (list; newest first)
 *
 * Required env:
 *   UPSTASH_REDIS_REST_URL   or REDIS_URL
 *   UPSTASH_REDIS_REST_TOKEN or REDIS_TOKEN
 */

// ---------- small helpers ----------
function corsJson(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// --- add these helpers near the top with the other Upstash helpers ---
async function upstashLIndex(key: string, index: number) {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/lindex/${encodeURIComponent(key)}/${index}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashDel(key: string) {
  const { url, token } = upstashEnv();
  if (!url || !token) return { ok: false };
  const r = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  return { ok: r.ok, status: r.status };
}


function upstashEnv() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN ?? "";
  return { url, token };
}

async function upstashLPush(key: string, value: string) {
  const { url, token } = upstashEnv();
  if (!url || !token) return { ok: false, reason: "no-env" };
  const r = await fetch(
    `${url}/lpush/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  return { ok: r.ok, status: r.status };
}

async function upstashLRange(key: string, start = 0, stop = 9) {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(
    `${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashLLen(key: string) {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(
    `${url}/llen/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return typeof j?.result === "number" ? j.result : null;
}

// ---------- CORS preflight ----------
export async function OPTIONS() {
  return corsJson({ ok: true, method: "OPTIONS" }, 204);
}

// ---------- GET: health + recent logs ----------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");
  const mode   = url.searchParams.get("mode");
  const limit  = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 10)));

  if (dryRun === "1") {
    return corsJson({ ok: true, dryRun: true, note: "Webhook endpoint reachable", fp: "webhook-v3" });
  }

  if (mode === "recent") {
    const items = await upstashLRange("hubspot:webhook:log", 0, limit - 1);
    return corsJson({ ok: true, mode, count: items ? items.length : 0, items });
  }

  if (mode === "count") {
    const n = await upstashLLen("hubspot:webhook:log");
    return corsJson({ ok: true, mode, length: n ?? 0 });
  }

  return corsJson({ ok: true, note: "GET health/log modes: ?dryRun=1 | ?mode=recent&limit=10 | ?mode=count", fp: "webhook-v3" });
}

// ---------- POST: dryRun or log real events ----------
export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");

  if (dryRun === "1") {
    return corsJson({ ok: true, dryRun: true, method: "POST", fp: "webhook-v3" });
  }

  // Parse JSON
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return corsJson({ ok: false, error: "invalid-json" }, 400);
  }

  // Accept either an array of events or a single event object
  const events: any[] = Array.isArray(payload) ? payload : (payload && typeof payload === "object" ? [payload] : []);

  if (events.length === 0) {
    return corsJson({ ok: false, error: "no-events" }, 400);
  }

  const entry = {
    ts: new Date().toISOString(),
    count: events.length,
    sample: events[0],
  };

  const write = await upstashLPush("hubspot:webhook:log", JSON.stringify(entry));

  return corsJson({
    ok: true,
    recorded: write.ok,
    received: events.length,
    note: "accepted",
    fp: "webhook-v3",
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");
  const mode   = url.searchParams.get("mode");
  const limit  = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 10)));
  const id     = Number(url.searchParams.get("id") ?? 0);

  if (dryRun === "1") {
    return corsJson({ ok: true, dryRun: true, note: "Webhook endpoint reachable", fp: "webhook-v3" });
  }

  if (mode === "recent") {
    const items = await upstashLRange("hubspot:webhook:log", 0, limit - 1);
    return corsJson({ ok: true, mode, count: items ? items.length : 0, items });
  }

  if (mode === "count") {
    const n = await upstashLLen("hubspot:webhook:log");
    return corsJson({ ok: true, mode, length: n ?? 0 });
  }

  // NEW: clear all logs
  if (mode === "clear") {
    const cleared = await upstashDel("hubspot:webhook:log");
    return corsJson({ ok: cleared.ok, mode, note: cleared.ok ? "log cleared" : "clear failed" });
  }

  // NEW: replay a single stored entry by index (0 = most recent)
  if (mode === "replay") {
    const raw = await upstashLIndex("hubspot:webhook:log", id);
    if (!raw) return corsJson({ ok: false, mode, error: "no-such-id" }, 404);

    let entry: any = null;
    try { entry = JSON.parse(raw); } catch { /* keep null */ }
    const sample = entry?.sample ?? null;

    if (!sample || typeof sample !== "object") {
      return corsJson({ ok: false, mode, error: "entry-missing-sample" }, 400);
    }

    // Repost the stored 'sample' back to THIS webhook (real, non-dry) as an array
    const res = await fetch(url.origin + "/api/hubspot/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([sample]),
      cache: "no-store",
    });

    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }

    return corsJson({
      ok: res.ok,
      mode,
      id,
      repostStatus: res.status,
      repostBody: data,
      replayedSample: sample,
    }, res.ok ? 200 : 500);
  }

  return corsJson({ ok: true, note: "GET modes: ?dryRun=1 | ?mode=recent&limit=10 | ?mode=count | ?mode=replay&id=0 | ?mode=clear", fp: "webhook-v3" });
}
