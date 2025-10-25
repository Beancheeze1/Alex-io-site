// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

/** ---------- helpers ---------- */
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

function upstashEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN ?? "";
  return { url, token };
}

async function upstashLPush(key: string, value: string) {
  const { url, token } = upstashEnv();
  if (!url || !token) return { ok: false, status: 500 };
  const r = await fetch(`${url}/lpush/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return { ok: r.ok, status: r.status };
}

async function upstashLRange(key: string, start = 0, stop = 9) {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashLLen(key: string) {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/llen/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return typeof j?.result === "number" ? j.result : null;
}

async function upstashLIndex(key: string, index: number) {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/lindex/${encodeURIComponent(key)}/${index}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashDel(key: string) {
  const { url, token } = upstashEnv();
  if (!url || !token) return { ok: false, status: 500 };
  const r = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return { ok: r.ok, status: r.status };
}

// temporary debug hook
if (process.env.LOG_WEBHOOK === "1") {
  console.log(`[WEBHOOK] received ${new Date().toISOString()}`);
}


// Replay target (avoids self-POST loops)
async function postToProcessor(sample: any) {
  try {
    const base = process.env.APP_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${base}/api/internal/hubspot/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([sample]),
      cache: "no-store",
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 500, data: String(err) };
  }
}

/** ---------- routes ---------- */
export async function OPTIONS() {
  return corsJson({ ok: true, method: "OPTIONS" }, 204);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");
  const mode = url.searchParams.get("mode");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 10)));
  const id = Number(url.searchParams.get("id") ?? 0);

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

  if (mode === "clear") {
    const cleared = await upstashDel("hubspot:webhook:log");
    return corsJson({ ok: cleared.ok, mode, note: cleared.ok ? "log cleared" : "clear failed" });
  }

  if (mode === "replay") {
    const raw = await upstashLIndex("hubspot:webhook:log", id);
    if (!raw) return corsJson({ ok: false, mode, error: "no-such-id" }, 404);

    let entry: any = null;
    try { entry = JSON.parse(raw); } catch { /* noop */ }
    const sample = entry?.sample ?? null;
    if (!sample || typeof sample !== "object") {
      return corsJson({ ok: false, mode, error: "entry-missing-sample" }, 400);
    }

    const replay = await postToProcessor(sample);
    return corsJson({
      ok: replay.ok,
      mode,
      id,
      status: replay.status,
      response: replay.data,
      replayedSample: sample,
    }, replay.ok ? 200 : 500);
  }

  return corsJson({ ok: true, note: "GET modes: ?dryRun=1 | ?mode=recent&limit=10 | ?mode=count | ?mode=replay&id=0 | ?mode=clear", fp: "webhook-v3" });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");

  // Dry-run: fast JSON, no parsing
  if (dryRun === "1") {
    return corsJson({ ok: true, dryRun: true, method: "POST", fp: "webhook-v3" });
  }

  // Accept array OR single object
  let payload: unknown;
  try { payload = await req.json(); } catch { return corsJson({ ok: false, error: "invalid-json" }, 400); }
  const events: any[] = Array.isArray(payload) ? payload : (payload && typeof payload === "object" ? [payload] : []);

  if (events.length === 0) return corsJson({ ok: false, error: "no-events" }, 400);

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
