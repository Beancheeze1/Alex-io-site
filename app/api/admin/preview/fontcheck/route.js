import { NextResponse } from "next/server";
import { renderQuotePdf } from "@/lib/oauthStore";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const buf = await renderQuotePdf({
      quote: { lines: [], subtotal: 0, taxPct: 0, taxAmt: 0, total: 0, orderSurcharge: { amount: 0 } },
      title: "Font Check", company: "Alex"
    });
    return NextResponse.json({ ok: true, pdfBytes: buf.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
