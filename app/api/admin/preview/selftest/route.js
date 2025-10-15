import { NextResponse } from "next/server";
import { renderQuotePdf } from "../../../../../lib/quotePdf.js";
import { hsUploadBuffer } from "../../../../../lib/hsFiles.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/preview/selftest?key=ADMIN_KEY&dry=1
 * - key      : must equal ADMIN_KEY (so you can hit it from a browser)
 * - dry=1    : generate PDF only (no upload)
 * - dry omitted : also uploads to HubSpot Files
 *
 * REMOVE THIS ROUTE after you validate things.
 */
export async function GET(req) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const dry = url.searchParams.get("dry") === "1";

  const admin = process.env.ADMIN_KEY || "";
  if (!admin) {
    return NextResponse.json({ ok:false, step:"auth", error:"ADMIN_KEY missing in env" }, { status: 500 });
  }
  if (key !== admin) {
    return NextResponse.json({ ok:false, step:"auth", error:"Unauthorized (bad key)" }, { status: 401 });
  }

  // --- Minimal “known-good” test input (adjust SKUs to ones you seeded) ---
  const quote = {
    lines: [
      { sku: "FOAM-PE-1_7-2X2", name: "Foam PE 1.7 2x2", qty: 100, unitPrice: 1.00, lineSubtotal: 100.00 },
      { sku: "CRATE-48x40x36", name: "Crate 48x40x36", qty: 10, unitPrice: 25.00, lineSubtotal: 250.00 }
    ],
    subtotal: 350.00,
    taxPct: 7.5,
    taxAmt: 26.25,
    total: 376.25,
    orderSurcharge: { percent: 0, flat: 0, amount: 0 }
  };
  // -----------------------------------------------------------------------

  try {
    // 1) PDF
    let pdf;
    try {
      pdf = await renderQuotePdf({ quote, title: "Self Test Quote", company: "Alex Packaging" });
    } catch (e) {
      return NextResponse.json({ ok:false, step:"pdf", error:String(e) }, { status: 500 });
    }

    if (dry) {
      return NextResponse.json({ ok:true, step:"dry", pdfBytes: pdf.length, totals:{ subtotal:quote.subtotal, tax:quote.taxAmt, total:quote.total } });
    }

    // 2) Upload
    try {
      const urlOut = await hsUploadBuffer({ filename: `selftest_${Date.now()}.pdf`, buffer: pdf, folderPath: "quotes" });
      return NextResponse.json({ ok:true, step:"upload", url:urlOut, totals:{ subtotal:quote.subtotal, tax:quote.taxAmt, total:quote.total } });
    } catch (e) {
      return NextResponse.json({ ok:false, step:"upload", error:String(e) }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json({ ok:false, step:"unknown", error:String(e) }, { status: 500 });
  }
}
