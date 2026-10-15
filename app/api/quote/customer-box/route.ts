// app/api/quote/customer-box/route.ts
//
// Public-facing endpoint to persist (or clear) a customer-entered box size
// against a quote's facts store.
//
// Called by the public layout editor (/quote/layout) when the user types dims
// into the "Customer box (inside)" inputs.
// Step 21: GET needs only the quote number. POST (a change) needs staff of the
// quote's shop, or the buyer's edit grant (lib/quote-edit.ts); buyers can't
// change a released (locked) quote.
//
// POST body:
//   { "quote_no": "Q-AI-...", "box": { "L": 18, "W": 12, "H": 6, "style": "mailer" | "rsc" } | null }
//
// GET params:
//   ?quote_no=Q-AI-...
//
// Behaviour:
//   POST – merges { customer_box_in: {L,W,H,style?} | null } into the facts store.
//          Step 28B: a bare { printed } (the editor's Printed checkbox) moves
//          the quote onto per-color printing (print_spec): printed = 1 spot
//          color, one side (or the quote's existing colors); not printed = no
//          colors. A changed print spec reprices the quote's boxes, so the
//          old art-setup fee + % no longer applies to these quotes.
//   GET  – returns the stored customer_box_in for the given quote.

import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { one } from "@/lib/db";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { buyerEditGuard } from "@/lib/quote-edit";
import { repriceQuoteBoxes } from "@/app/lib/packaging-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };

type BoxStyle = "mailer" | "rsc";

function coerceBox(
  raw: any,
): { L: number; W: number; H: number; style?: BoxStyle } | null {
  if (!raw || typeof raw !== "object") return null;
  const L = Number(raw.L);
  const W = Number(raw.W);
  const H = Number(raw.H);
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  const box: { L: number; W: number; H: number; style?: BoxStyle } = { L, W, H };
  if (raw.style === "mailer" || raw.style === "rsc") box.style = raw.style;
  return box;
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const quoteNo = (searchParams.get("quote_no") || "").trim();

    if (!quoteNo) {
      return NextResponse.json(
        { ok: false, error: "MISSING_QUOTE_NO" },
        { status: 400 },
      );
    }

    const facts = (await loadFacts(quoteNo)) || {};
    const box = coerceBox((facts as any)?.customer_box_in);
    const printed = !!(
      (facts as any)?.printed === 1 ||
      (facts as any)?.printed === true ||
      (facts as any)?.printed === "1"
    );

    const print_spec = parsePrintSpec((facts as any)?.print_spec);
    return NextResponse.json({ ok: true, box: box ?? null, printed, print_spec });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 },
    );
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const quoteNo = (body?.quote_no || "").trim();
    // Distinguish "box" omitted (e.g. a printed-only update) from "box"
    // explicitly sent as null (an intentional clear) — omitting it must NOT
    // wipe a previously saved box.
    const hasBoxKey = Object.prototype.hasOwnProperty.call(body ?? {}, "box");
    const rawBox = body?.box ?? null;
    // Optional: also persist printed flag when included in the same request
    const printedRaw = body?.printed;

    if (!quoteNo) {
      return NextResponse.json(
        { ok: false, error: "MISSING_QUOTE_NO" },
        { status: 400 },
      );
    }

    const quote = await one<QuoteRow>(
      `SELECT id, quote_no, tenant_id, locked FROM quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );

    if (!quote) {
      return NextResponse.json(
        { ok: false, error: "QUOTE_NOT_FOUND" },
        { status: 404 },
      );
    }

    // Step 21: staff of the quote's shop, or the buyer's edit link; buyers
    // can't change a released quote.
    const guard = await buyerEditGuard(req, quote, {
      rateName: "customer-box",
      perMin: 120,
      lockedMessage: "This quote has been released. Contact the shop to change it.",
    });
    if (guard) return guard;

    const existing = (await loadFacts(quoteNo)) || {};
    const box = hasBoxKey ? coerceBox(rawBox) : coerceBox((existing as any)?.customer_box_in);

    const patch: Record<string, any> = {};
    if (hasBoxKey) {
      patch.customer_box_in = box ?? null;
    }
    if (typeof printedRaw === "boolean" || printedRaw === 1 || printedRaw === 0) {
      patch.printed = printedRaw ? 1 : 0;
    }
    // Per-color print spec (Corrugated Step 3B): { colors: ("spot"|"flood")[], sides: 1|2 }.
    const ex = existing as Record<string, unknown>;
    const prevSpec = parsePrintSpec(ex.print_spec);
    if (Object.prototype.hasOwnProperty.call(body ?? {}, "print_spec")) {
      const spec = parsePrintSpec(body.print_spec);
      if (spec) {
        patch.print_spec = spec;
        patch.printed = spec.colors.length > 0 ? 1 : 0;
      }
    } else if ("printed" in patch && ex.print_mode !== "per_box") {
      // Step 28B: the printed flag alone (layout editor checkbox) -> per-color printing.
      patch.print_spec = patch.printed
        ? prevSpec && prevSpec.colors.length > 0
          ? prevSpec
          : { colors: ["spot"], sides: 1 }
        : { colors: [], sides: prevSpec?.sides ?? 1 };
    }
    await saveFacts(quoteNo, { ...(existing as any), ...patch });

    // Step 28B: a new print spec reprices the boxes already on the quote.
    if (patch.print_spec && JSON.stringify(patch.print_spec) !== JSON.stringify(prevSpec) && ex.print_mode !== "per_box") {
      const boxes = await one<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.quote_box_selections WHERE quote_id = $1`,
        [quote.id],
      );
      if (Number(boxes?.n) > 0) {
        try {
          await repriceQuoteBoxes(quote.id, quote.tenant_id == null ? null : Number(quote.tenant_id), patch.print_spec);
        } catch (e) {
          console.error("[customer-box] box reprice failed", { quoteNo, err: String(e) });
        }
      }
    }

    return NextResponse.json({ ok: true, box: box ?? null });
  } catch (err: any) {
    console.error("Error in /api/quote/customer-box:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 },
    );
  }
}
