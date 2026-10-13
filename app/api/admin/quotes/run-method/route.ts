// app/api/admin/quotes/run-method/route.ts
//
// Step 15: how a quote's boxes are made, chosen by staff.
//   GET  ?quote_no=…           -> { ok, method: "auto"|"plates"|"digital", cutoff, short_runs_on, locked }
//   POST { quote_no, method }  -> saves facts.run_method ("auto" removes it), then
//                                 reprices the quote's boxes with it
// "plates" = production run (plates, press, converting); "digital" = short
// run (digital print + CAD cut, no plates); "auto" = digital under the
// shop's short-run cutoff. Buyers never choose: their quotes are auto.
// Staff (admin / cs / sales) of the quote's shop, or the platform owner.
// Released (locked) quotes are refused: revise them first.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { loadCorrugated } from "@/lib/corrugated";
import { parsePrintSpec, parseRunMethod, shortRunsOn } from "@/lib/corrugated-price";
import { repriceQuoteBoxes } from "@/app/lib/packaging-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The quote, when the caller is staff of its shop (or the platform owner). */
async function staffQuote(req: NextRequest, quoteNoRaw: unknown): Promise<{ quote: QuoteRow } | { res: NextResponse }> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: json({ ok: false, error: "unauthorized" }, 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: json({ ok: false, error: "forbidden" }, 403) };

  const quoteNo = typeof quoteNoRaw === "string" ? quoteNoRaw.trim().slice(0, 40) : "";
  if (!quoteNo) return { res: json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400) };

  const quote = await one<QuoteRow>(
    `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
    return { res: json({ ok: false, error: "not_found", message: "Quote not found." }, 404) };
  }
  return { quote };
}

export async function GET(req: NextRequest) {
  try {
    const r = await staffQuote(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in r) return r.res;
    const facts = ((await loadFacts(r.quote.quote_no)) || {}) as Record<string, unknown>;
    const cfg = await loadCorrugated(Number(r.quote.tenant_id));
    return json({
      ok: true,
      method: parseRunMethod(facts.run_method) ?? "auto",
      cutoff: Number(cfg.settings.digital_under_qty) || 0,
      short_runs_on: shortRunsOn(cfg.settings),
      locked: !!r.quote.locked,
    });
  } catch (e) {
    console.error("[admin/quotes/run-method] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the run method." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as { quote_no?: unknown; method?: unknown } | null;
    const r = await staffQuote(req, b?.quote_no);
    if ("res" in r) return r.res;
    const { quote } = r;

    if (quote.locked) {
      return json(
        { ok: false, error: "quote_locked", message: "This quote is released. Revise it to change the run method." },
        409,
      );
    }

    const raw = b?.method;
    const method = raw === "auto" ? null : parseRunMethod(raw);
    if (raw !== "auto" && !method) {
      return json({ ok: false, error: "invalid_method", message: "Pick auto, plates or digital." }, 400);
    }

    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...facts };
    if (method) next.run_method = method;
    else delete next.run_method;
    await saveFacts(quote.quote_no, next);

    // Reprice the boxes now with the new method (same print rules as Reprice).
    const boxes = await q<{ id: number }>(`SELECT id FROM public.quote_box_selections WHERE quote_id = $1`, [quote.id]);
    if (boxes.length > 0) {
      const printArg = next.print_mode === "per_box" ? "per_box" : parsePrintSpec(next.print_spec);
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), printArg);
    }

    return json({ ok: true, quote_no: quote.quote_no, method: method ?? "auto", boxes_repriced: boxes.length });
  } catch (e) {
    console.error("[admin/quotes/run-method] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't change the run method. Please try again." }, 500);
  }
}
