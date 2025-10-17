import { NextResponse } from "next/server";
import { tokenStore } from "../../../../lib/tokenStore";
import { hsFetch } from "../../../../lib/hsClient";   // <-- NEW
void tokenStore;

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/hubspot/webhook", method: "GET" }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();

    let events: any[] = [];
    try {
      const parsed = JSON.parse(raw);
      events = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.events) ? (parsed as any).events : [];
    } catch {
      return NextResponse.json({ ok: false, step: "parse", error: "invalid_json" }, { status: 400 });
    }

    // group by portal so we only fetch/refresh tokens once per portalId
    const byPortal = new Map<number, any[]>();
    for (const ev of events) {
      const portalId = Number(ev?.portalId ?? ev?.accountId);
      if (!portalId || Number.isNaN(portalId)) continue;
      if (!byPortal.has(portalId)) byPortal.set(portalId, []);
      byPortal.get(portalId)!.push(ev);
    }

    const portals = Array.from(byPortal.keys());
    const results: any[] = [];

    for (const portalId of portals) {
      // 1) validate we have a token for this portal and it can auth
      try {
        const res = await hsFetch(portalId, "https://api.hubapi.com/oauth/v1/access-tokens/inspect", { method: "POST" });
        const info = await res.json().catch(() => ({}));
        results.push({ portalId, auth: "ok", tokenInfo: info });
      } catch (e: any) {
        results.push({ portalId, auth: "fail", error: e?.message || String(e) });
        continue; // skip any action for this portal if auth fails
      }

      // 2) TODO: action per event type (we’ll add once you confirm the subscription)
      // for (const ev of byPortal.get(portalId)!) {
      //   if (ev.subscriptionType === "conversations.message.create") {
      //     await hsFetch(portalId, "https://api.hubapi.com/<conversations-endpoint>", {
      //       method: "POST",
      //       body: { /* ... */ }
      //     });
      //   }
      // }
    }

    return NextResponse.json(
      { ok: true, received: events.length, portals: results },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: "exception", error: e?.message || String(e) }, { status: 500 });
  }
}
