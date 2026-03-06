// app/api/my-quotes/route.ts
//
// Returns quotes assigned to the currently logged-in user.
// - Uses sales_rep_id on public."quotes".
// - Also returns commission_pct and computed commission_usd for the rep.
// - Read-only, Path A safe.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Number.isFinite(Number(limitParam)) ? Number(limitParam) : 100,
      200,
    );

    const rows = await q<QuoteRow>(
      `
      SELECT id,
             quote_no,
             customer_name,
             email,
             phone,
             status,
             created_at,
             updated_at
      FROM public."quotes"
      WHERE sales_rep_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
      `,
      [user.id, limit],
    );

    // Commission summary — mirrors print route pricing exactly.
    // Pre-apply quotes have no quote_items; price from Redis facts instead.
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const repUser = await one<{ commission_pct: number | null }>(
      `SELECT commission_pct FROM public.users WHERE id = $1`,
      [user.id],
    );

    const myQuotes = await q<{ id: number; quote_no: string }>(
      `SELECT id, quote_no FROM public.quotes WHERE sales_rep_id = $1`,
      [user.id],
    );

    const quoteIds = myQuotes.map((r) => r.id);
    let quotesTotalUsd = 0;

    if (myQuotes.length > 0) {
      const { loadFacts } = await import("@/app/lib/memory");

      function parseDims(dims: any): { L: number; W: number; H: number } | null {
        if (!dims) return null;
        if (typeof dims === "object") {
          const L = Number(dims.L), W = Number(dims.W), H = Number(dims.H);
          return [L, W, H].every((n) => Number.isFinite(n) && n > 0) ? { L, W, H } : null;
        }
        const [L, W, H] = String(dims).split("x").map((s) => Number(s.trim()));
        return [L, W, H].every((n) => Number.isFinite(n) && n > 0) ? { L, W, H } : null;
      }

      async function calcTotal(L: number, W: number, H: number, qty: number, material_id: number): Promise<number> {
        try {
          const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ length_in: L, width_in: W, height_in: H, material_id, qty, cavities: [], round_to_bf: false }),
          });
          const j = await r.json().catch(() => ({}));
          return Number(j?.result?.total) || Number(j?.result?.price_total) || Number(j?.total) || 0;
        } catch { return 0; }
      }

      const quoteTotals = await Promise.all(
        myQuotes.map(async ({ id: quoteId, quote_no }) => {
          const items = await q<{
            length_in: string; width_in: string; height_in: string;
            qty: number; material_id: number; price_total_usd: string | null; notes: string | null;
          }>(
            `SELECT length_in, width_in, height_in, qty, material_id, price_total_usd, notes
             FROM public.quote_items WHERE quote_id = $1`,
            [quoteId],
          );

          const boxes = await q<{ extended_price_usd: string | null }>(
            `SELECT extended_price_usd FROM public.quote_box_selections WHERE quote_id = $1`,
            [quoteId],
          );
          const boxTotal = boxes.reduce((s, b) => s + (Number(b.extended_price_usd) || 0), 0);

          let foamTotal = 0;

          if (items.length === 0) {
            // Pre-apply: use Redis facts
            const facts = (await loadFacts(quote_no)) || {};
            const dims = parseDims((facts as any).dims);
            const qty = Number((facts as any).qty);
            const materialId = Number((facts as any).material_id);
            if (dims && qty > 0 && materialId > 0) {
              foamTotal = await calcTotal(dims.L, dims.W, dims.H, qty, materialId);
            }
          } else {
            const prices = await Promise.all(
              items
                .filter((it) => {
                  const n = String(it.notes || "").toUpperCase();
                  return !n.includes("[LAYOUT-LAYER]") && !n.includes("[PACKAGING]") && !n.includes("REQUESTED SHIPPING CARTON");
                })
                .map(async (it) => {
                  if (it.price_total_usd !== null && Number(it.price_total_usd) > 0) return Number(it.price_total_usd);
                  const L = Number(it.length_in), W = Number(it.width_in), H = Number(it.height_in);
                  const qty = Number(it.qty), materialId = Number(it.material_id);
                  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0) || !(qty > 0) || !(materialId > 0)) return 0;
                  return calcTotal(L, W, H, qty, materialId);
                }),
            );
            foamTotal = prices.reduce((s, p) => s + p, 0);
          }

          return Math.round((foamTotal + boxTotal) * 100) / 100;
        }),
      );

      quotesTotalUsd = Math.round(quoteTotals.reduce((s, t) => s + t, 0) * 100) / 100;
    }

    const commPct = Number(repUser?.commission_pct ?? 0);
    const commissionUsd = Math.round(quotesTotalUsd * (commPct / 100) * 100) / 100;

    return NextResponse.json({
      ok: true,
      quotes: rows,
      commission: {
        pct: repUser?.commission_pct ?? null,
        quotes_total_usd: quotesTotalUsd,
        commission_usd: commissionUsd,
        quote_count: myQuotes.length,
      },
    });
  } catch (err: any) {
    console.error("my-quotes GET error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}