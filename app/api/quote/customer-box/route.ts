// app/api/quote/customer-box/route.ts
//
// Public-facing endpoint to persist (or clear) a customer-entered box size
// against a quote's facts store.
//
// Called by the public layout editor (/quote/layout) when the user types dims
// into the "Customer box (inside)" inputs.  No admin auth required — only
// a valid quote_no is needed to confirm the quote exists.
//
// POST body:
//   { "quote_no": "Q-AI-...", "box": { "L": 18, "W": 12, "H": 6 } | null }
//
// GET params:
//   ?quote_no=Q-AI-...
//
// Behaviour:
//   POST – merges { customer_box_in: {L,W,H} | null } into the facts store.
//   GET  – returns the stored customer_box_in for the given quote.

import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = { id: number };

function coerceBox(raw: any): { L: number; W: number; H: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const L = Number(raw.L);
  const W = Number(raw.W);
  const H = Number(raw.H);
  if ([L, W, H].every((n) => Number.isFinite(n) && n > 0)) return { L, W, H };
  return null;
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

    return NextResponse.json({ ok: true, box: box ?? null, printed });
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
    const rawBox = body?.box ?? null;
    // Optional: also persist printed flag when included in the same request
    const printedRaw = body?.printed;

    if (!quoteNo) {
      return NextResponse.json(
        { ok: false, error: "MISSING_QUOTE_NO" },
        { status: 400 },
      );
    }

    // Confirm the quote exists (no full auth required — just existence check).
    const quote = await one<QuoteRow>(
      `SELECT id FROM quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );

    if (!quote) {
      return NextResponse.json(
        { ok: false, error: "QUOTE_NOT_FOUND" },
        { status: 404 },
      );
    }

    const box = coerceBox(rawBox);

    const existing = (await loadFacts(quoteNo)) || {};
    const patch: Record<string, any> = { customer_box_in: box ?? null };
    if (typeof printedRaw === "boolean" || printedRaw === 1 || printedRaw === 0) {
      patch.printed = printedRaw ? 1 : 0;
    }
    await saveFacts(quoteNo, { ...(existing as any), ...patch });

    return NextResponse.json({ ok: true, box: box ?? null });
  } catch (err: any) {
    console.error("Error in /api/quote/customer-box:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 },
    );
  }
}
