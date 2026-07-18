// app/api/admin/diagnostics/internal-notes-leak/route.ts
//
// One-time (but safe to re-run) audit: RepStartQuoteModal used to thread its
// "Internal notes" field into BOTH quotes.internal_notes (staff-only) AND the
// general `notes` URL param that seeds quote_layout_packages.notes — a field
// /api/quote/print has always returned and QuotePrintClient.tsx has always
// rendered on the customer-facing print page. This scans existing quotes for
// layout notes that look like they were meant to stay internal, so any
// already-exposed quotes can be found and remediated individually.
//
// Admin-only, read-only. Not wired into any UI — hit directly by staff.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { loadFacts } from "@/app/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

// Broad net, per the request: exact "STAFF ONLY" plus generally-internal-sounding
// phrasing that would be unusual in genuine layout/production instructions.
const SUSPECT_PATTERNS = [
  "staff only",
  "internal only",
  "internal use",
  "internal note",
  "do not mention",
  "don't mention",
  "do not tell",
  "don't tell",
  "do not share",
  "don't share",
  "do not disclose",
  "don't disclose",
  "not for customer",
  "not customer facing",
  "not visible to customer",
  "confidential",
  "no discount",
  "discount",
  "margin",
  "markup",
  "cost basis",
  "wholesale",
];

type Row = {
  quote_no: string;
  customer_name: string;
  email: string | null;
  status: string;
  created_at: string;
  internal_notes: string | null;
  layout_notes: string | null;
  layout_notes_created_at: string | null;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);

  const role = (user?.role || "").toLowerCase();
  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  if (role !== "admin")
    return json({ ok: false, error: "FORBIDDEN", message: "Admin access required." }, 403);

  // Broad mode: dataset is small enough to return EVERY layout package row
  // with non-null notes (not just the latest per quote, not just keyword
  // matches) so a human can eyeball all of it directly, not just what a
  // keyword heuristic happens to catch. `is_latest_package` and
  // `keyword_match` are both included as flags to help triage, not as filters.
  const keywordWhere = SUSPECT_PATTERNS.map((_, i) => `lp.notes ilike $${i + 2}`).join(" or ");

  const rows = await q<
    Row & { is_latest_package: boolean; keyword_match: boolean }
  >(
    `
    select
      q.quote_no,
      q.customer_name,
      q.email,
      q.status,
      q.created_at,
      q.internal_notes,
      lp.notes as layout_notes,
      lp.created_at as layout_notes_created_at,
      lp.id = latest.id as is_latest_package,
      (${keywordWhere}) as keyword_match
    from public.quotes q
    join public.quote_layout_packages lp on lp.quote_id = q.id
    join lateral (
      select id
      from public.quote_layout_packages
      where quote_id = q.id
      order by created_at desc
      limit 1
    ) latest on true
    where q.tenant_id = $1
      and lp.notes is not null
      and trim(lp.notes) <> ''
    order by q.created_at desc, lp.created_at asc
    limit 500
    `,
    [user.tenant_id, ...SUSPECT_PATTERNS.map((p) => `%${p}%`)],
  );

  // Best-effort secondary check: does the ephemeral facts store (14-day TTL)
  // still carry the same text in facts.notes for any matched quote? Only
  // meaningful for recent quotes — older ones will simply come back empty.
  const withFacts = await Promise.all(
    rows.map(async (r) => {
      let factsNotes: string | null = null;
      try {
        const facts: any = await loadFacts(r.quote_no);
        factsNotes = typeof facts?.notes === "string" ? facts.notes : null;
      } catch {
        // non-fatal
      }
      return {
        ...r,
        facts_notes: factsNotes,
        internal_notes_matches_layout_notes:
          !!r.internal_notes && !!r.layout_notes && r.layout_notes.includes(r.internal_notes),
        // status='sent' (or later states that only follow an explicit send,
        // e.g. accepted/lost) means staff actually emailed the customer-facing
        // print link to the customer — the strongest signal of real exposure.
        // Other statuses (draft/applied/revised) mean the page exists and is
        // publicly reachable by anyone with the quote_no, but no confirmed
        // email was sent.
        confirmed_emailed_to_customer:
          r.status === "sent" || r.status === "accepted" || r.status === "lost",
      };
    }),
  );

  return json({ ok: true, count: withFacts.length, quotes: withFacts });
}
