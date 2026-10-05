// app/api/public/quote-number/route.ts
//
// GET /api/public/quote-number?kind=A|R
// Returns a new, collision-checked quote number for the start-quote flows.
// Demo (D) numbers are only made by /api/demo/seed. Rate limited per IP.
// Nothing is reserved in the database; the quote row is created later
// (Apply / POST /api/quotes) using this number.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { newUniqueQuoteNo } from "@/lib/quote-no-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = await rateLimit(req, 30, "quote-number");
  if (!rate.success) return rateLimitResponse(rate.reset);

  const kind = (req.nextUrl.searchParams.get("kind") || "A").trim().toUpperCase() === "R" ? "R" : "A";

  try {
    const quoteNo = await newUniqueQuoteNo(kind);
    return NextResponse.json({ ok: true, quoteNo }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[quote-number] failed:", err);
    return NextResponse.json(
      { ok: false, error: "quote_number_failed", message: "Could not create a quote number." },
      { status: 500 },
    );
  }
}
