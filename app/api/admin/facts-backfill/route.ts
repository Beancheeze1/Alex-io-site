// app/api/admin/facts-backfill/route.ts
//
// POST /api/admin/facts-backfill  (Step 10C, platform owner only)
//
// One-time copy of every quote's facts from Redis into public.quote_facts
// (migration 032), so quotes saved before 10C stop depending on the Redis
// expiry. Safe to run more than once: quotes already in quote_facts are
// skipped. Demo quotes (Q-D- / Q-DEMO-) are skipped.
// -> { ok, quotes, copied, already, empty, demo }

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts } from "@/app/lib/memory";
import { isDemoQuoteNo } from "@/lib/quote-no";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || !isPlatformOwner(user)) return json({ ok: false, error: "forbidden" }, 403);

    // Step 14: paged (?after_id=, ?limit=, default 200) so a large table can't time out.
    // Run again with after_id = next_after_id until next_after_id is null.
    const afterId = Math.max(0, Number(req.nextUrl.searchParams.get("after_id")) || 0);
    const limit = Math.min(1000, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 200));
    const quotes = await q<{ id: number; quote_no: string }>(
      `SELECT id, quote_no FROM public.quotes WHERE quote_no IS NOT NULL AND id > $1 ORDER BY id ASC LIMIT $2`,
      [afterId, limit],
    );

    let copied = 0;
    let already = 0;
    let empty = 0;
    let demo = 0;

    for (const row of quotes) {
      const quoteNo = String(row.quote_no || "").trim();
      if (!quoteNo) continue;
      if (isDemoQuoteNo(quoteNo)) {
        demo += 1;
        continue;
      }
      const have = await one<{ quote_no: string }>(
        `SELECT quote_no FROM public.quote_facts WHERE quote_no = $1`,
        [quoteNo],
      );
      if (have) {
        already += 1;
        continue;
      }
      const facts = (await loadFacts(quoteNo)) || {};
      if (!facts || Object.keys(facts).length === 0) {
        empty += 1;
        continue;
      }
      await q(
        `INSERT INTO public.quote_facts (quote_no, facts, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (quote_no) DO NOTHING`,
        [quoteNo, JSON.stringify(facts)],
      );
      copied += 1;
    }

    const nextAfterId = quotes.length === limit ? Number(quotes[quotes.length - 1].id) : null;
    return json({ ok: true, quotes: quotes.length, copied, already, empty, demo, next_after_id: nextAfterId });
  } catch (e) {
    console.error("[admin/facts-backfill] failed:", e);
    return json({ ok: false, error: "server_error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
}
