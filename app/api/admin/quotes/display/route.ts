// app/api/admin/quotes/display/route.ts
//
// Step 39D: a boxes-only quote as a display (or any multi-part job): die line
// parts + an "Assembly and packing" line priced from the shop's rates
// (Pricing → Corrugated boxes → Displays and multi-part jobs).
// Staff only (admin / cs / sales of the quote's shop, or the platform owner).
//
//   GET  ?quote_no=…
//     -> { ok, boxes_only, locked, per_box, is_display, displays, parts: [...],
//          other_lines, assembly: { id, unit, total, detail, override } | null }
//   POST { quote_no, action: "start" | "update" | "stop",
//          displays, parts: [{ id, per_display, label }],
//          override: { minutes_per_display, usd_per_display } }
//     start  -> adds the assembly line (needs at least one die line part)
//     update -> sets the number of displays, each part's count per display and
//               name, and this quote's assembly override
//     stop   -> removes the assembly line (every line back to one quantity)
//   Every change sets each part's qty = displays x per display (other lines =
//   displays), the quote's qty and compare quantity = displays, and reprices
//   every line at today's rates. Released (locked) quotes are refused.
//   One print setting per quote: quotes priced per size are refused.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import {
  customSelectionInsert,
  displayContext,
  repriceQuoteBoxes,
  resolveAssemblySelection,
  setQuoteBoxQty,
} from "@/app/lib/packaging-selection";
import { parseDielineBlank } from "@/lib/dieline-import";
import { ASSEMBLY_STYLE, parseAssemblyOverride, perDisplayOf } from "@/lib/display-assembly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };
type Line = {
  id: number;
  kind: string;
  qty: number | string;
  custom_style: string | null;
  description: string | null;
  unit_price_usd: string | number | null;
  extended_price_usd: string | number | null;
  tooling_usd: string | number | null;
  pricing_detail: unknown;
  needs_review: boolean | null;
  pricing_note: string | null;
  dieline: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

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

async function loadLines(quoteId: number): Promise<Line[]> {
  return q<Line>(
    `SELECT qbs.id, qbs.kind, qbs.qty, qbs.custom_style, qbs.description,
            qbs.unit_price_usd, qbs.extended_price_usd, (to_jsonb(qbs) ->> 'tooling_usd') AS tooling_usd,
            qbs.pricing_detail, qbs.needs_review, qbs.pricing_note,
            to_jsonb(qbs) -> 'dieline' AS dieline
       FROM public.quote_box_selections qbs
      WHERE qbs.quote_id = $1
      ORDER BY qbs.id`,
    [quoteId],
  );
}

export async function GET(req: NextRequest) {
  try {
    const r = await staffQuote(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in r) return r.res;
    const { quote } = r;
    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const lines = await loadLines(quote.id);
    const boxesOnly = facts.pack_type === "boxes_only" && lines.length > 0;
    if (!boxesOnly) return json({ ok: true, boxes_only: false });
    const asm = lines.find((l) => l.custom_style === ASSEMBLY_STYLE) ?? null;
    const ctx = await displayContext(quote.id);
    return json({
      ok: true,
      boxes_only: true,
      locked: !!quote.locked,
      per_box: facts.print_mode === "per_box",
      is_display: !!asm,
      displays: ctx.displays,
      parts: lines
        .filter((l) => l.custom_style === "dieline")
        .map((l) => {
          const d = parseDielineBlank(l.dieline);
          return {
            id: Number(l.id),
            label: d?.label ?? null,
            filename: d?.filename ?? null,
            piece: d?.piece ?? null,
            per_display: perDisplayOf(l.dieline),
            qty: Number(l.qty) || 0,
            unit: num(l.unit_price_usd),
            extended: num(l.extended_price_usd),
            tooling: num(l.tooling_usd),
            description: l.description,
            blank: d ? { length_in: d.length_in, width_in: d.width_in, rule_in: d.rule_in } : null,
          };
        }),
      other_lines: lines
        .filter((l) => l.custom_style !== "dieline" && l.custom_style !== ASSEMBLY_STYLE)
        .map((l) => ({ id: Number(l.id), description: l.description, qty: Number(l.qty) || 0 })),
      assembly: asm
        ? {
            id: Number(asm.id),
            unit: num(asm.unit_price_usd),
            total: num(asm.extended_price_usd),
            detail: (asm.pricing_detail as { assembly?: unknown } | null)?.assembly ?? null,
            override: parseAssemblyOverride(asm.dieline),
            needs_review: !!asm.needs_review,
            note: asm.pricing_note,
          }
        : null,
    });
  } catch (e) {
    console.error("[admin/quotes/display] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the display." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return json({ ok: false, error: "invalid_body" }, 400);
    const r = await staffQuote(req, b.quote_no);
    if ("res" in r) return r.res;
    const { quote } = r;
    if (quote.locked) {
      return json({ ok: false, error: "quote_locked", message: "This quote is released. Revise it before changing it." }, 409);
    }
    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const lines = await loadLines(quote.id);
    if (!(facts.pack_type === "boxes_only" && lines.length > 0)) {
      return json({ ok: false, error: "not_boxes_only", message: "Displays are set up on boxes-only quotes." }, 400);
    }
    if (facts.print_mode === "per_box") {
      return json(
        { ok: false, error: "per_box", message: "This quote prices each size with its own printing; displays use one print setting for the quote." },
        400,
      );
    }
    const action = b.action === "start" || b.action === "stop" ? b.action : "update";
    const asm = lines.find((l) => l.custom_style === ASSEMBLY_STYLE) ?? null;
    const parts = lines.filter((l) => l.custom_style === "dieline");

    const d = Number(b.displays);
    const displays = Number.isInteger(d) && d >= 1 && d <= 10_000_000 ? d : Math.max(1, Math.round(Number(facts.qty) || 1));
    const print = parsePrintSpec(facts.print_spec);

    if (action === "stop") {
      if (asm) await q(`DELETE FROM public.quote_box_selections WHERE id = $1 AND quote_id = $2`, [asm.id, quote.id]);
      await setQuoteBoxQty(quote.id, displays);
      await saveFacts(quote.quote_no, { ...facts, qty: displays, box_qty_breaks: [displays] });
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), print);
      return json({ ok: true, is_display: false });
    }

    if (parts.length === 0) {
      return json({ ok: false, error: "no_parts", message: "Add at least one part from a die line file first." }, 400);
    }

    // Parts: count per display and name.
    const asked = Array.isArray(b.parts) ? (b.parts as Record<string, unknown>[]) : [];
    for (const p of asked.slice(0, 200)) {
      const line = parts.find((x) => Number(x.id) === Number(p.id));
      if (!line) continue;
      const pd = Number(p.per_display);
      const patch: Record<string, unknown> = {};
      if (Number.isInteger(pd) && pd >= 1 && pd <= 10000) patch.per_display = pd;
      if (typeof p.label === "string") patch.label = p.label.trim().slice(0, 60) || null;
      if (Object.keys(patch).length) {
        await q(
          `UPDATE public.quote_box_selections SET dieline = COALESCE(dieline, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [line.id, JSON.stringify(patch)],
        );
      }
    }

    // This quote's assembly override (blank = use the shop's rates).
    const ovRaw = (b.override && typeof b.override === "object" ? b.override : {}) as Record<string, unknown>;
    const override = parseAssemblyOverride(ovRaw);

    if (!asm) {
      const ctx = await displayContext(quote.id);
      const resolved = await resolveAssemblySelection(Number(quote.tenant_id), displays, ctx.partsPerDisplay, override);
      const ins = customSelectionInsert({
        quoteId: quote.id,
        quoteNo: quote.quote_no,
        L: 0,
        W: 0,
        H: 0,
        style: ASSEMBLY_STYLE,
        qty: displays,
        resolved,
        dieline: override,
      });
      await q(ins.text, ins.values);
    } else if (b.override !== undefined) {
      await q(`UPDATE public.quote_box_selections SET dieline = $2::jsonb WHERE id = $1`, [asm.id, JSON.stringify(override)]);
    }

    await setQuoteBoxQty(quote.id, displays);
    await saveFacts(quote.quote_no, { ...facts, qty: displays, box_qty_breaks: [displays], display: { displays } });
    await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), print);
    return json({ ok: true, is_display: true, displays });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42703") {
      return json({ ok: false, error: "not_migrated", message: "Displays aren't set up yet (migrations 049 and 050)." }, 503);
    }
    console.error("[admin/quotes/display] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't save the display. Please try again." }, 500);
  }
}
