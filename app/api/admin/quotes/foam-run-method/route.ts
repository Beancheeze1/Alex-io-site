// app/api/admin/quotes/foam-run-method/route.ts
//
// Step 23: how a quote's FOAM is cut, chosen by staff.
//   GET  ?quote_no=…  -> { ok, has_foam, method, die_owned, resolved, cutoff,
//                         cnc_on, die_on, lines, detail, model, locked }
//   POST { quote_no, method?: "auto"|"cnc"|"die", die_owned?: boolean }
//        -> saves facts.foam_run_method ("auto" removes it) and
//           facts.foam_die_owned; the quote page / email pick it up at once
//           (the cutting lines are worked out from these each time).
// "cnc" = short run (CNC / waterjet / knife, no tooling); "die" = steel-rule
// die + press. Buyers never choose: their quotes are auto.
// Staff (admin / cs / sales) of the quote's shop, or the platform owner.
// Released (locked) quotes are refused: revise them first.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { lockedChargeSettings } from "@/app/lib/pricing/foam-lock";
import { foamChargeLines, latestLayoutJson, quoteFoamGeometry } from "@/app/lib/pricing/foam-quote";
import { cncOn, dieOn, parseFoamRunChoice, resolveFoamMethod } from "@/app/lib/pricing/foam-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };
type ItemRow = { length_in: string; width_in: string; height_in: string; qty: number; notes: string | null };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

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

function isBillableFoam(notes: string | null): boolean {
  const n = String(notes || "").toUpperCase();
  return !n.includes("[LAYOUT-LAYER]") && !n.includes("[PACKAGING]") && !n.includes("REQUESTED SHIPPING CARTON");
}

export async function GET(req: NextRequest) {
  try {
    const r = await staffQuote(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in r) return r.res;
    const { quote } = r;

    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    // Read-only: today's settings unless the quote already has a saved lock.
    const settings = await lockedChargeSettings(quote.quote_no, await getPricingSettings(Number(quote.tenant_id)), false);

    const items = await q<ItemRow>(
      `SELECT length_in, width_in, height_in, qty, notes FROM public.quote_items WHERE quote_id = $1 ORDER BY id ASC`,
      [quote.id],
    );
    const primary = items.find((it) => isBillableFoam(it.notes) && Number(it.length_in) > 0 && Number(it.qty) > 0);
    const choice = parseFoamRunChoice(facts.foam_run_method);
    const base = {
      ok: true,
      method: choice,
      die_owned: facts.foam_die_owned === true,
      cutoff: settings.foam_process.foam_die_over_qty,
      cnc_on: cncOn(settings.foam_process),
      die_on: dieOn(settings.foam_process),
      model: settings.model,
      locked: !!quote.locked,
    };
    if (!primary) return json({ ...base, has_foam: false, resolved: null, lines: [], detail: null });

    const qty = Number(primary.qty);
    const geom = quoteFoamGeometry(await latestLayoutJson(quote.id), {
      L: Number(primary.length_in),
      W: Number(primary.width_in),
      H: Number(primary.height_in),
    });
    const proc = foamChargeLines({ settings, geom, qty, legacyQty: Number(items[0]?.qty) || 0, facts });
    return json({
      ...base,
      has_foam: true,
      resolved: settings.model === 2 ? resolveFoamMethod(choice, qty, settings.foam_process) : null,
      lines: proc.lines,
      // Step 39N: glue lines and layers as priced (sheet by sheet on quotes priced from Step 39L on)
      detail: { ...proc.detail, glue_lines: proc.detail.glue_lines, layers: proc.detail.layers_cut, cavity_ci: geom.cavity_ci },
    });
  } catch (e) {
    console.error("[admin/quotes/foam-run-method] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the foam cutting method." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as { quote_no?: unknown; method?: unknown; die_owned?: unknown } | null;
    const r = await staffQuote(req, b?.quote_no);
    if ("res" in r) return r.res;
    const { quote } = r;

    if (quote.locked) {
      return json(
        { ok: false, error: "quote_locked", message: "This quote is released. Revise it to change how the foam is cut." },
        409,
      );
    }

    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...facts };

    if (b && "method" in b) {
      const raw = String(b.method ?? "");
      if (!["auto", "cnc", "die"].includes(raw)) {
        return json({ ok: false, error: "invalid_method", message: "Pick auto, cnc or die." }, 400);
      }
      if (raw === "auto") delete next.foam_run_method;
      else next.foam_run_method = raw;
    }
    if (b && "die_owned" in b) {
      if (b.die_owned === true) next.foam_die_owned = true;
      else delete next.foam_die_owned;
    }
    await saveFacts(quote.quote_no, next);

    return json({
      ok: true,
      quote_no: quote.quote_no,
      method: parseFoamRunChoice(next.foam_run_method),
      die_owned: next.foam_die_owned === true,
    });
  } catch (e) {
    console.error("[admin/quotes/foam-run-method] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't save. Please try again." }, 500);
  }
}
