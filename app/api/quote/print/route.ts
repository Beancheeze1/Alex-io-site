// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package) by quote_no.
// PATH-A FIX: When DB items/layout are empty (pre-Apply), seed PRIMARY item + pricing
//             from persisted FACTS (saved at email time by orchestrate).
//
// GET /api/quote/print?quote_no=Q-AI-20251221-222713
//
// Notes:
// - We DO NOT require Apply-to-Quote for interactive quote to show qty/material/pricing.
// - DB remains source-of-truth once items/layout exist; facts are a fallback only.
// - This route is read-only (no DB writes).

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
  sales_rep_slug: string | null;
  created_at: string | null;
};

type QuoteItemRow = {
  id: number;
  quote_id: number;
  qty: number | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  material_id: number | null;
  color: string | null;
  created_at: string | null;
};

function parseDims(dims: string | null | undefined): { L: number; W: number; H: number } | null {
  if (!dims) return null;
  const parts = String(dims)
    .toLowerCase()
    .replace(/"/g, "")
    .trim()
    .split("x")
    .map((s) => Number(s));
  if (parts.length < 3) return null;
  const [L, W, H] = parts;
  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(H)) return null;
  if (L <= 0 || W <= 0 || H <= 0) return null;
  return { L, W, H };
}

async function calcFromFacts(opts: {
  dims: string;
  qty: number;
  material_id: number;
  round_to_bf?: boolean;
}) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const { L, W, H } = parseDims(opts.dims) || { L: 0, W: 0, H: 0 };

  if (!L || !W || !H) return null;

  const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      length_in: L,
      width_in: W,
      height_in: H,
      material_id: opts.material_id,
      qty: opts.qty,
      cavities: [],
      round_to_bf: !!opts.round_to_bf,
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) return null;
  return j.result ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const quoteNo = String(url.searchParams.get("quote_no") || "").trim();

    if (!quoteNo) {
      return NextResponse.json({ ok: false, error: "missing_quote_no" }, { status: 400 });
    }

    // 1) Quote header (DB required)
    const quote = await one<QuoteRow>(
      `
      select id, quote_no, customer_name, email, phone, status, sales_rep_slug, created_at
      from quotes
      where quote_no = $1
      limit 1;
      `,
      [quoteNo],
    );

    if (!quote) {
      // If header isn't stored yet, the interactive quote cannot exist.
      // This is expected only if orchestrate didn't create the header.
      return NextResponse.json(
        { ok: false, error: "quote_not_found", quote_no: quoteNo },
        { status: 404 },
      );
    }

    // 2) Items from DB (may be empty pre-Apply)
    const itemsDb = await q<QuoteItemRow>(
      `
      select id, quote_id, qty, length_in, width_in, height_in, material_id, color, created_at
      from quote_items
      where quote_id = $1
      order by id asc;
      `,
      [quote.id],
    );

    // 3) Latest layout package (may be empty pre-Apply)
    const layoutPkg = await one<any>(
      `
      select
        lp.id,
        lp.created_at,
        lp.layout_json,
        lp.svg_text,
        lp.dxf_text,
        lp.step_text
      from quote_layout_packages lp
      where lp.quote_id = $1
      order by lp.created_at desc
      limit 1;
      `,
      [quote.id],
    );

    // 4) Facts fallback (ONLY if DB items are empty)
    const facts = await loadFacts(quoteNo).catch(() => ({} as any));

    let itemsOut: any[] = Array.isArray(itemsDb) ? [...itemsDb] : [];
    let usedFacts = false;

    if (!itemsOut.length) {
      const dims = String(facts?.dims || "").trim() || null;
      const qty = Number(facts?.qty || 0);
      const material_id = Number(facts?.material_id || 0);

      const parsed = parseDims(dims);
      if (parsed && Number.isFinite(qty) && qty > 0) {
        usedFacts = true;

        // Synthesize a primary item row-like object
        const primary: any = {
          id: 0,
          quote_id: quote.id,
          qty,
          length_in: parsed.L,
          width_in: parsed.W,
          height_in: parsed.H,
          material_id: Number.isFinite(material_id) && material_id > 0 ? material_id : null,
          color: facts?.color ?? null,
          // include these for UI seeding (non-DB fields)
          material_name: facts?.material_name ?? null,
          material_family: facts?.material_family ?? null,
          density: facts?.density ?? null,
          _seeded_from_facts: true,
        };

        // Attach a pricing snapshot if we have material_id.
        if (primary.material_id) {
          const calc = await calcFromFacts({
            dims: dims as string,
            qty: primary.qty,
            material_id: primary.material_id,
            round_to_bf: false,
          });

          if (calc) {
            primary.pricing_snapshot = calc;
            // Convenience mirrors for common fields used by UI
            primary.price_total =
              calc.price_total ?? calc.order_total ?? calc.total ?? calc.orderTotal ?? null;
            primary.price_each =
              primary.price_total && primary.qty ? primary.price_total / primary.qty : null;
            primary.min_charge_applied = calc.min_charge_applied ?? null;
          }
        }

        itemsOut = [primary];
      }
    }

    return NextResponse.json(
      {
        ok: true,
        quote,
        items: itemsOut,
        layout_package: layoutPkg || null,
        // expose facts only for debugging / seeding checks
        facts_seeded: usedFacts ? { dims: facts?.dims, qty: facts?.qty, material_id: facts?.material_id } : null,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "print_exception", detail: String(e?.message || e) },
      { status: 500 },
    );
  }
}
