// app/api/admin/quotes/internal-notes/route.ts
//
// Staff-only read of quotes.internal_notes by quote_no.
//
// Deliberately separate from /api/quote/print: that endpoint's response is
// consumed by the customer-facing print page (QuotePrintClient.tsx) as well
// as the admin detail view, so internal_notes must never be added to it —
// doing so would ship the field to every customer's browser in the network
// response even if the UI never rendered it. This route exists so the admin
// quote detail page can load internal_notes without touching that shared
// endpoint at all.
//
// Step 39V: POST { quote_no, note } adds "Oct 24, 2026 – Name: note" at the
// end of the internal notes (staff: admin / cs / sales of the shop) and
// returns { ok, internal_notes }. Earlier notes are never changed, and the
// quote's own "updated" time isn't touched (a note isn't a quote change).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { appendNote, cleanNote, noteLine } from "@/app/lib/internal-notes-core";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);

  const role = (user?.role || "").toLowerCase();
  const isStaff = role === "admin" || role === "sales" || role === "cs";

  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  if (!isStaff)
    return json({ ok: false, error: "FORBIDDEN", message: "Staff access required." }, 403);

  const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim();
  if (!quoteNo) {
    return json({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  }

  const quote = await one<{ internal_notes: string | null }>(
    `select internal_notes from quotes where quote_no = $1 and tenant_id = $2`,
    [quoteNo, user.tenant_id],
  );

  if (!quote) {
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }

  return json({ ok: true, internal_notes: quote.internal_notes ?? null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);
  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  const role = (user.role || "").toLowerCase();
  if (!(role === "admin" || role === "sales" || role === "cs")) {
    return json({ ok: false, error: "FORBIDDEN", message: "Staff access required." }, 403);
  }

  const body = (await req.json().catch(() => null)) as { quote_no?: unknown; note?: unknown } | null;
  const quoteNo = typeof body?.quote_no === "string" ? body.quote_no.trim().slice(0, 40) : "";
  if (!quoteNo) return json({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  const note = cleanNote(body?.note);
  if (!note) return json({ ok: false, error: "EMPTY_NOTE", message: "Type a note first." }, 400);

  const quote = await one<{ id: number; internal_notes: string | null }>(
    `select id, internal_notes from quotes where quote_no = $1 and tenant_id = $2`,
    [quoteNo, user.tenant_id],
  );
  if (!quote) return json({ ok: false, error: "NOT_FOUND" }, 404);

  const settings = (await getPricingSettings(Number(user.tenant_id)).catch(() => null)) as { shop_timezone?: unknown } | null;
  const tz = String(settings?.shop_timezone || "") || "America/New_York";
  const author = String((user as { name?: unknown }).name || "").trim() || String(user.email || "").split("@")[0] || "Staff";
  const next = appendNote(quote.internal_notes, noteLine(note, author, new Date(), tz));

  const saved = await one<{ internal_notes: string | null }>(
    `update quotes set internal_notes = $1 where id = $2 and tenant_id = $3 returning internal_notes`,
    [next, quote.id, user.tenant_id],
  );
  return json({ ok: true, internal_notes: saved?.internal_notes ?? next });
}
