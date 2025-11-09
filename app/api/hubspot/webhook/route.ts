import { NextResponse, NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** env helpers */
function flag(name: string, dflt = false) {
  const v = process.env[name];
  if (!v) return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** compute our public base URL (no trailing slash) */
function baseUrl(req: NextRequest) {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  // fallback to request origin (Render/CF will give https://api.alex-io.com)
  const o = new URL(req.url).origin.replace(/\/$/, "");
  return o;
}

/** tiny logger */
function log(part: string, obj: any) {
  try {
    // keep logs compact but readable
    // biome-ignore lint/suspicious/noConsole: runtime log
    console.log(part, JSON.stringify(obj, null, 2));
  } catch {
    // biome-ignore lint/suspicious/noConsole: runtime log
    console.log(part, obj);
  }
}

/** types from our lookup/orchestrate endpoints */
type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  error?: string;
  status?: number;
  detail?: string;
  src?: any;
};

type OrchestrateIn = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
};

export async function POST(req: NextRequest) {
  const started = Date.now();
  const traces: Array<{ path: string; url: string; ok: boolean; status: number }> = [];

  try {
    // --- Parse HubSpot batch payload (we only need objectId) ---
    // HubSpot sends an array of events; we handle 1+ robustly.
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const list: any[] = Array.isArray(body) ? body : [body];
    const first = list.find(Boolean) ?? {};
    const objectId =
      Number(first.objectId) ||
      Number(first.threadId) ||
      Number(first?.subscriptionType ? first?.objectId : undefined) ||
      0;

    log("[webhook] received", {
      subscriptionType: first?.subscriptionType,
      objectId,
      messageId: first?.messageId,
      messageType: first?.messageType,
      changeFlag: first?.changeFlag,
    });

    // --- Dry-run detection ---
    // Real webhooks DO NOT include ?dryRun=1, so default must be FALSE.
    const qsDry = req.nextUrl.searchParams.get("dryRun");
    const dryRun = qsDry === "1" || qsDry === "true";

    // --- Reply enable gate (env) ---
    const replyEnabled = flag("REPLY_ENABLED", false);

    if (!objectId) {
      const res = {
        ok: false,
        reason: "missing_objectId",
      };
      log("[webhook] error", res);
      return NextResponse.json(res, { status: 200 });
    }

    // --- Step 1: lookup customer email/subject/text from the thread ---
    const base = baseUrl(req);
    const lookupUrl = `${base}/api/hubspot/lookupEmail?t=${Date.now()}`;
    const lookupRes = await fetch(lookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ objectId }),
    });

    const lookupText = await lookupRes.text();
    let lookup: LookupOut;
    try {
      lookup = JSON.parse(lookupText) as LookupOut;
    } catch {
      lookup = { ok: false, status: lookupRes.status, error: "lookup_parse_error", detail: lookupText.slice(0, 800) };
    }

    traces.push({ path: "/api/hubspot/lookupEmail", url: lookupUrl, ok: lookupRes.ok, status: lookupRes.status });

    if (!lookup.ok || !lookup.email) {
      const res = {
        ok: true,
        dryRun,
        send_ok: false,
        toEmail: lookup?.email ?? "",
        reason: "missing_toEmail",
        lookup_traces: traces,
      };
      log("[webhook] missing_toEmail", res);
      return NextResponse.json(res, { status: 200 });
    }

    // --- Step 2: orchestrate the reply ---
    const orchUrl = `${base}/api/ai/orchestrate?t=${Date.now()}`;
    const orchPayload: OrchestrateIn = {
      mode: "ai",
      toEmail: lookup.email,
      subject: lookup.subject || undefined,
      text: lookup.text || undefined,
      inReplyTo: String(objectId),
      dryRun, // <-- only true if ?dryRun=1 was explicitly given
    };

    // If replies are disabled AND not a manual dry-run call, skip sending but log the decision
    if (!replyEnabled && !dryRun) {
      log("[orchestrate] DRYRUN or REPLY_DISABLED", { dryRun: true, replyEnabled });
      const res = {
        ok: true,
        dryRun: true,
        send_ok: true,
        toEmail: lookup.email,
        lookup_traces: traces,
        note: "Reply disabled by REPLY_ENABLED env; treated as dry-run.",
      };
      return NextResponse.json(res, { status: 200 });
    }

    const orchRes = await fetch(orchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(orchPayload),
    });

    traces.push({ path: "/api/ai/orchestrate", url: orchUrl, ok: orchRes.ok, status: orchRes.status });

    const out = await orchRes.json().catch(() => ({}));

    const res = {
      ok: true,
      dryRun,
      send_ok: orchRes.ok,
      toEmail: lookup.email,
      ms: Date.now() - started,
      lookup_traces: traces,
      orchestrate_status: orchRes.status,
      orchestrate_result: out,
    };
    log("[webhook] done", res);
    return NextResponse.json(res, { status: 200 });
  } catch (err: any) {
    const res = {
      ok: false,
      error: err?.message ?? "webhook_route_exception",
    };
    log("[webhook] exception", res);
    return NextResponse.json(res, { status: 200 });
  }
}
