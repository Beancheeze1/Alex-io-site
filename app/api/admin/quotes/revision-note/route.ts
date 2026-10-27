// app/api/admin/quotes/revision-note/route.ts
//
// Step 44d: the Revise box. POST { quote_no, description, by } saves the
// description and "revised by" initials for the revision the quote's next
// layout Apply will carry (the letter a Revise just opened, else the next
// staging letter). They show in the revision block on the 3-view PDF
// drawings. Staff (admin / cs / sales) of the shop; the quote must not be
// released (Revise unlocks it first). Returns { ok, revision }.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { cleanRevBy, cleanRevDescription, upcomingStageLetter, withRevisionNote } from "@/lib/revision-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
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

  const body = (await req.json().catch(() => null)) as { quote_no?: unknown; description?: unknown; by?: unknown } | null;
  const quoteNo = typeof body?.quote_no === "string" ? body.quote_no.trim().slice(0, 40) : "";
  if (!quoteNo) return json({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  const description = cleanRevDescription(body?.description);
  const by = cleanRevBy(body?.by);
  if (!description) return json({ ok: false, error: "EMPTY_DESCRIPTION", message: "Type a short description of the revision." }, 400);
  if (!by) return json({ ok: false, error: "EMPTY_BY", message: "Enter the initials of who is revising it." }, 400);

  const quote = await one<{ id: number; locked: boolean | null }>(
    `select id, locked from quotes where quote_no = $1 and tenant_id = $2`,
    [quoteNo, user.tenant_id],
  );
  if (!quote) return json({ ok: false, error: "NOT_FOUND" }, 404);
  if (quote.locked) {
    return json({ ok: false, error: "LOCKED", message: "This quote is released. Revise it first, then add the note." }, 409);
  }

  try {
    const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, unknown>;
    const revision = upcomingStageLetter(facts);
    await saveFacts(
      quoteNo,
      withRevisionNote(facts, revision, { description, by, at: new Date().toISOString(), user_id: Number(user.id) || null }),
    );
    return json({ ok: true, revision });
  } catch (e) {
    console.error("revision-note: save failed", e);
    return json({ ok: false, error: "SAVE_FAILED", message: "Couldn't save the revision note." }, 500);
  }
}
