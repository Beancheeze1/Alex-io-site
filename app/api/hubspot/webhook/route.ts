// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HubSpotEvent = {
  subscriptionType?: string;
  objectId?: number | string;
  messageId?: string;
  changeFlag?: string;
};

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}
function err(error: string, detail?: any, status = 200) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

/* ---------------- helpers ---------------- */

async function parseJSON(req: NextRequest): Promise<any> {
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j;
  } catch {}
  try {
    const t = await req.text();
    if (!t) return {};
    let s = t.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);
  } catch {}
  return {};
}

function mapToEvent(o: any): HubSpotEvent {
  const sub = o?.subscriptionType ?? o?.subscription_type ?? o?.eventType ?? "";
  const oid = o?.objectId ?? o?.objectID ?? o?.threadId ?? o?.id ?? o?.subjectId ?? o?.resourceId;
  const mid = o?.messageId ?? o?.messageID ?? (typeof o?.id === "string" ? o.id : undefined);
  const chg = o?.changeFlag ?? o?.change ?? o?.eventType ?? "";
  return {
    subscriptionType: typeof sub === "string" ? sub : String(sub || ""),
    objectId: typeof oid === "number" || typeof oid === "string" ? oid : undefined,
    messageId: typeof mid === "string" ? mid : undefined,
    changeFlag: typeof chg === "string" ? chg : undefined,
  };
}

function normalizeEvents(body: any): { events: HubSpotEvent[]; shape: string; keys: string[] } {
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  if (Array.isArray(body)) return { events: body.map(mapToEvent), shape: "array", keys: [] };
  if (body && typeof body === "object") {
    if (Array.isArray(body.events)) return { events: body.events.map(mapToEvent), shape: "wrapper.events", keys };
    if (Array.isArray(body.results)) return { events: body.results.map(mapToEvent), shape: "wrapper.results", keys };
    return { events: [mapToEvent(body)], shape: "object", keys };
  }
  return { events: [], shape: "unknown", keys: [] };
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

function subjectRoot(s: string) {
  let t = String(s || "").trim();
  t = t.replace(/^(re|fwd?|aw):\s*/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/* ---------------- route ---------------- */

export async function POST(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const urlLookup = `${base}/api/hubspot/lookupEmail`;
  const urlOrchestrate = `${base}/api/ai/orchestrate`;

  try {
    // Visible entry log (headers subset)
    {
      const headersLog: Record<string, string> = {};
      for (const k of [
        "content-type",
        "content-length",
        "x-hubspot-signature",
        "x-hubspot-signature-v3",
        "x-hubspot-request-timestamp",
        "x-forwarded-host",
        "x-forwarded-proto",
      ]) {
        const v = req.headers.get(k);
        if (v) headersLog[k] = v;
      }
      console.info("[webhook] -> entry {");
      console.info("  method:", req.method + ",");
      console.info("  path:", JSON.stringify(new URL(req.url).pathname) + ",");
      console.info("  headers:", headersLog, "\n}");
    }

    const raw = await parseJSON(req);
    const { events, shape, keys } = normalizeEvents(raw);
    if (!events.length) {
      console.warn("[webhook] unsupported_shape", { shape, keys });
      return ok({ send_ok: false, reason: "unsupported_shape", shape, keys });
    }

    // Prefer conversation.newMessage
    const ev =
      events.find(e => String(e?.subscriptionType || "").toLowerCase().includes("conversation.newmessage")) ||
      events[0];

    const objectId = String(ev?.objectId ?? "").trim();
    const messageId = String(ev?.messageId ?? "").trim();

    // Lookup with light retry (covers participant lag)
    const lookupOnce = async () => {
      const qs: string[] = [];
      if (objectId) qs.push(`objectId=${encodeURIComponent(objectId)}`);
      if (messageId) qs.push(`messageId=${encodeURIComponent(messageId)}`);
      const lookupURL = qs.length ? `${urlLookup}?${qs.join("&")}` : urlLookup;
      const res = await fetch(lookupURL, { method: "GET", cache: "no-store" });
      const j = await res.json().catch(() => ({} as any));
      return { res, j, url: lookupURL };
    };

    let { res: lookupRes, j: lookup, url: lookupURL } = await lookupOnce();
    if (!lookup?.email) {
      await delay(1200);
      ({ res: lookupRes, j: lookup, url: lookupURL } = await lookupOnce());
    }

    const toEmail = String(lookup?.email || "").trim();
    const subject = String(lookup?.subject || "").trim(); // ALWAYS forward subject
    const textRaw = String(lookup?.text || "");
    const threadId = String(lookup?.threadId || objectId || "").trim();

    const alias = toEmail && subject ? `hsu:${toEmail.toLowerCase()}::${subjectRoot(subject).toLowerCase()}` : "";

    console.info(
      "[webhook] lookup_ok",
      JSON.stringify({ email: toEmail || null, subject: subject || "(no subject)", threadId: threadId || "(none)" })
    );

    if (!toEmail) {
      console.info(
        "[webhook] exit {",
        "reason: 'no_email_lookup_failed',",
        "extra:",
        JSON.stringify({ objectId, changeFlag: ev?.changeFlag || "" }),
        "}"
      );
      return ok({ ignored: true, reason: "no_email_lookup_failed", extra: { objectId, changeFlag: ev?.changeFlag || "" } });
    }

    // Build orchestrate payload — subject is ALWAYS included
    const orchBody = {
      mode: "ai" as const,
      toEmail,
      subject: subject || "(no subject)",
      text: textRaw || "",
      threadId: threadId ? `hs:${threadId}` : undefined, // primary memory key
      dryRun: false,
    };

    console.info(
      "[orchestrate] msgraph/send { to:",
      toEmail,
      ", dryRun: false , threadId:",
      orchBody.threadId || "<none>",
      ", alias:",
      alias || "<none>",
      ", inReplyTo:",
      "none",
      "}"
    );

    const orchRes = await fetch(urlOrchestrate, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orchBody),
      cache: "no-store",
    });

    const ms = Date.now();
    console.info(
      "[webhook] AI ok",
      JSON.stringify({ to: toEmail, status: orchRes.status, ms: ms % 100000 }) // short ms tag
    );

    return ok({ status: orchRes.status });
  } catch (e: any) {
    console.error("[webhook] exception", e?.message || e);
    return err("webhook_exception", String(e?.message || e));
  }
}
