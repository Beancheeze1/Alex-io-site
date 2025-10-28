// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ---- Loop-protection helpers (headers + hidden HTML marker) ----
type HeaderKV = { name: string; value: string };

function hasLoopHeader(headers?: HeaderKV[]) {
  return !!headers?.some(
    (h) => h?.name?.toLowerCase() === "x-alexio-sent" && String(h?.value) === "1"
  );
}

function hasLoopMarker(html?: string) {
  return typeof html === "string" && html.includes("alexio:sent=1");
}

function shouldIgnoreFromMessage(message: any) {
  // Try both places: headers array (if present) and HTML/text body
  const headers = message?.headers as HeaderKV[] | undefined;
  const html = (message?.html ?? message?.text ?? message?.body) as string | undefined;
  return hasLoopHeader(headers) || hasLoopMarker(html);
}

// ---- Health ----
export async function GET() {
  return NextResponse.json({ ok: true, message: "Webhook route active" });
}

// ---- POST (HubSpot posts an array of events) ----
// Supports ?dryRun=1 for safe local testing.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // HubSpot normally sends an array; for dry runs we accept any JSON.
  const payload = await req.json().catch(() => null);

  // -------- Early-ignore (loop protection) --------
  // Try to locate a "message"-shaped object in payload.
  // - Real HS events: look for ev.message inside an array
  // - Dry runs: allow { message: {...} }
  let sampleMessage: any = null;
  if (payload && Array.isArray(payload) && payload.length > 0) {
    sampleMessage = payload[0]?.message ?? payload[0]; // best-effort
  } else if (payload && payload.message) {
    sampleMessage = payload.message;
  } else {
    sampleMessage = payload;
  }

  const isLoop = shouldIgnoreFromMessage(sampleMessage);
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ignored: isLoop,
      reason: isLoop ? "ignored: loop-marker/header" : "processable: no marker",
    });
  }
  if (isLoop) {
    // Early short-circuit in production to avoid loops
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "ignored: loop-marker/header",
    });
  }
  // -------- End early-ignore --------

  // ===== Your existing responder logic goes below =====
  // Path-A: keep it minimal; plug your current pipeline here.
  // Example skeleton (leave commented if you already have real logic):
  //
  // try {
  //   const decisions = Array.isArray(payload) ? payload : [payload];
  //   // TODO: resolve conversation/thread ids, fetch context, draft reply, etc.
  //   // await respondToHubSpot(decisions);
  //   return NextResponse.json({ ok: true, processed: decisions.length });
  // } catch (err) {
  //   return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  // }

  // Temporary neutral response so deploys clean even without downstream logic.
  return NextResponse.json({ ok: true, processed: 0, note: "Responder stub (Path-A)" });
}
