// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import { sendGraphMail } from "@/lib/msgraph";

/**
 * Small helpers
 */
const bool = (v: string | undefined | null, def = false) =>
  v == null ? def : /^(1|true|yes|on)$/i.test(v);

const safeStr = (v: any, d = "") =>
  typeof v === "string" && v.trim().length ? v.trim() : d;

const json = (o: any, init?: number) =>
  NextResponse.json(o, { status: init ?? 200 });

function baseUrlFromReq(req: Request) {
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  }
}

/**
 * Fetch a fresh HubSpot access token by calling your internal refresh endpoint.
 * (You already have /api/hubspot/refresh wired up.)
 */
async function getHubSpotAccessToken(req: Request): Promise<string | null> {
  try {
    const base = baseUrlFromReq(req);
    const r = await fetch(`${base}/api/hubspot/refresh`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Fallback: resolve an inbound customer's email by scanning the thread's messages.
 * We walk newest → oldest and pick the first inbound EMAIL sender.
 */
async function resolveInboundEmailFromThread(
  objId: string,
  hubspotAccessToken: string
): Promise<string | null> {
  try {
    const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${objId}/messages?limit=50`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${hubspotAccessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!r.ok) {
      console.log("[responder] thread fetch failed:", r.status);
      return null;
    }
    const data = await r.json();
    const msgs: any[] = data?.results ?? data?.messages ?? [];
    if (!Array.isArray(msgs)) return null;

    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const dir = String(m?.direction ?? m?.directionality ?? "").toLowerCase();
      const ch = String(m?.channel ?? m?.originChannel ?? "").toLowerCase();
      const fromEmail =
        m?.from?.email ?? m?.sender?.email ?? m?.senderEmail ?? null;

      const isIncoming = dir.includes("in"); // inbound / incoming
      const isEmail = ch === "email";

      if (isIncoming && isEmail && fromEmail) {
        return String(fromEmail).trim();
      }
    }
    return null;
  } catch (err) {
    console.log("[responder] fallback error:", (err as Error)?.message);
    return null;
  }
}

/**
 * POST: sends email via Graph.
 * Accepts JSON body:
 *  {
 *    "to"?: string,                 // explicit recipient (optional)
 *    "subject"?: string,
 *    "html"?: string,
 *    "objId"?: string               // HubSpot conversation thread id (optional)
 *  }
 * If "to" is missing and "objId" is present, we try to resolve the inbound sender
 * from the thread messages as a fallback.
 */
export async function POST(req: Request) {
  // --- env checks and flags
  const REPLY_ENABLED = bool(process.env.REPLY_ENABLED ?? "false", false);
  const FROM = safeStr(process.env.MS_MAILBOX_FROM);
  const hasTenant = !!process.env.MS_TENANT_ID;
  const hasClientId = !!process.env.MS_CLIENT_ID;
  const hasClientSecret = !!process.env.MS_CLIENT_SECRET;

  // parse request
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // ignore; body stays {}
  }

  let to = safeStr(body?.to);
  const objId = safeStr(body?.objId);
  const subject = safeStr(
    body?.subject,
    "[Alex-IO] Default Test — responder"
  );
  const html = safeStr(body?.html, "<p>Hello from Alex-IO responder.</p>");

  // log a compact summary for Render logs
  console.log("[webhook] envelope { subType:'', objId:'%s', channel:'', direction:'' }", objId);
  console.log("[webhook] env { REPLY_ENABLED:'%s', MS_TENANT_ID:'%s', MS_CLIENT_ID:'%s', MS_CLIENT_SECRET:'%s', MS_MAILBOX_FROM: '%s' }",
    String(REPLY_ENABLED), String(hasTenant), String(hasClientId), String(hasClientSecret), FROM || "(missing)"
  );

  // basic gate checks
  if (!REPLY_ENABLED) {
    return json({
      ok: true,
      sent: false,
      reason: "reply_disabled",
    });
  }
  if (!FROM || !hasTenant || !hasClientId || !hasClientSecret) {
    return json({
      ok: false,
      sent: false,
      reason: "graph_env_missing",
    }, 500);
  }

  // If "to" is not supplied, try to resolve from HubSpot thread (fallback)
  if (!to && objId) {
    const hubspotAccessToken = await getHubSpotAccessToken(req);
    if (hubspotAccessToken) {
      const fallback = await resolveInboundEmailFromThread(
        objId,
        hubspotAccessToken
      );
      if (fallback) {
        to = fallback;
        console.log(
          "[responder] fallback resolved customerEmail from thread: %s",
          to
        );
      } else {
        console.log("[responder] fallback lookup still empty");
      }
    } else {
      console.log("[responder] hubspot access token unavailable");
    }
  }

  // If we STILL don't have a recipient, noop with a clean reason
  if (!to) {
    const reason = objId ? "no_customer_email" : "missing_objId";
    console.log(
      "[responder] missing objId and no explicit 'to' – noop (reason=%s)",
      reason
    );
    return json({
      ok: true,
      sent: false,
      reason,
    });
  }

  // At this point we have a "to" and can try Graph
  try {
    const result = await sendGraphMail({
      to,
      subject,
      html,
      // You can extend with cc/bcc if desired later
    });

    // We assume your sendGraphMail returns something like { status, requestId }
    return json({
      ok: true,
      sent: true,
      action: "graph-send",
      note: "accepted",
      graph: {
        status: result?.status ?? 202,
        requestId: result?.requestId ?? null,
      },
    });
  } catch (err: any) {
    console.log("[responder] graph error:", err?.message || String(err));
    return json(
      {
        ok: false,
        sent: false,
        action: "error",
        error: err?.message || String(err),
      },
      500
    );
  }
}

/**
 * Optional GET: quick curl -i smoke test
 *   curl.exe -i https://api.alex-io.com/api/admin/responder?t=123
 */
export async function GET() {
  return json({
    ok: true,
    route: "/api/admin/responder",
  });
}
