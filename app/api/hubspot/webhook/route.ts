// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Conditional logger to Render logs */
function log(...args: any[]) {
  if (process.env.LOG_WEBHOOK === "1" || process.env.LOG_LEVEL === "debug") {
    console.log("[webhook]", ...args);
  }
}

function safeJsonParse(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: text ? JSON.parse(text) : undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

function summarizePayload(body: any) {
  try {
    if (Array.isArray(body) && body.length) {
      const first = body[0];
      return {
        cnt: body.length,
        subType: first?.subscriptionType || first?.eventType || first?.event?.type,
        obj: first?.objectId || first?.objectType || first?.event?.objectId,
      };
    }
    if (body && typeof body === "object") {
      const keys = Object.keys(body).slice(0, 6);
      return { keys };
    }
  } catch {}
  return undefined;
}

/** Try to call your existing responder without a hard import path. */
async function runResponder(body: any, ctx: any): Promise<any> {
  const candidates = [
    "@/lib/responder",
    "../../../lib/responder",
    "../../../../lib/responder",
    "@/lib/webhook",
    "../../../lib/webhook",
    "../../../../lib/webhook",
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- dynamic path may not exist; that's expected
      const mod = await import(p);
      if (typeof mod?.handleHubSpotWebhook === "function") {
        return await mod.handleHubSpotWebhook(body, ctx);
      }
      if (typeof mod?.default === "function") {
        return await mod.default(body, ctx);
      }
    } catch {
      // keep trying others
    }
  }

  // Fallback: do nothing, just acknowledge
  return { sent: false, action: "no-responder" };
}

/** GET — simple health/dry-run */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  log("GET hit", { dryRun, qs: url.search });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ignored: false,
      reason: "processable: dry-run ping",
      t: Date.now(),
    });
  }
  return NextResponse.json({ ok: true, method: "GET", t: Date.now() });
}

/** POST — main HubSpot webhook entry */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // Build a typed headers object safely (avoids TS issues with entries/map).
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let raw = "";
  try {
    raw = await req.text();
  } catch (e: any) {
    log("POST read error", e?.message || e);
    return NextResponse.json({ ok: false, error: "Failed to read request body" }, { status: 400 });
  }

  const parsed = safeJsonParse(raw);
  const body = parsed.ok ? parsed.value : undefined;

  log("POST hit", {
    dryRun,
    len: raw?.length ?? 0,
    json: parsed.ok,
    summary: summarizePayload(body),
    ua: headers["user-agent"],
    hubspotSig: headers["x-hubspot-signature-v3"] ? "present" : "missing",
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ignored: false,
      reason: "processable: no marker",
    });
  }

  if (!parsed.ok) {
    log("JSON parse error", parsed.error);
    return NextResponse.json(
      { ok: true, ignored: true, reason: `invalid json: ${parsed.error}` },
      { status: 200 }
    );
  }

  try {
    const result = await runResponder(body, { headers, url: req.url });

    const compact =
      result && typeof result === "object"
        ? {
            sent: result.sent ?? result.ok ?? false,
            action: result.action || result.type || undefined,
            note: result.note || result.reason || undefined,
          }
        : { sent: !!result };

    log("Responder output", compact);

    return NextResponse.json(
      {
        ok: true,
        processed: true,
        compact,
        t: Date.now(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    log("Responder error", err?.message || err);
    return NextResponse.json(
      {
        ok: true,
        processed: false,
        error: "responder threw",
        t: Date.now(),
      },
      { status: 200 }
    );
  }
}
