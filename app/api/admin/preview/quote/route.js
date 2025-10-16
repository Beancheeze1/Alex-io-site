import { NextResponse } from "next/server";
import { fetchCaps } from "@/lib/hubspotCaps.js";
import { renderQuotePdf } from "@/lib/quote-pdf-lib.js";
import { hsUploadBuffer } from "@/lib/hsFiles.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/preview/quote?hubId=...&dry=1
export async function POST(req) {
  try {
    const url = new URL(req.url);
    const hubId = url.searchParams.get("hubId") || process.env.HUBSPOT_PORTAL_ID || null;

    // simple admin guard
    const adminKey = req.headers.get("x-admin-key");
    if (!adminKey || adminKey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
      return NextResponse.json({ ok: false, step: "auth", error: "unauthorized" }, { status: 401 });
    }

    // body (provide defaults so you can test immediately)
    const payload = await req.json().catch(() => ({}));
    const {
      items = [
        { sku: "FOAM-PE-1_7-2X2", qty: 100 },
        { sku: "CRATE-48x40x36", qty: 10 }
      ],
      customerTierCode = "VIP",
      rush = true,
      shipState = "OH"
    } = payload;

    // ---- demo pricing; replace with your real pricing call if you have one ----
    const lines = items.map(i => ({
      sku: i.sku,
      name: i.sku,
      qty: Number(i.qty || 0),
      unitPrice: 1,
      lineSubtotal: Number(i.qty || 0) * 1
    }));
    const subtotal = lines.reduce((s, L) => s + L.lineSubtotal, 0);
    const taxPct = 7.5;
    const taxAmt = +(subtotal * (taxPct / 100)).toFixed(2);
    const total = +(subtotal + taxAmt).toFixed(2);
    const quote = {
      lines, subtotal, taxPct, taxAmt, total,
      orderSurcharge: { percent: 0, flat: 0, amount: 0 },
      meta: { customerTierCode, rush, shipState }
    };
    // -------------------------------------------------------------------------

    // always render a PDF
    const pdf = await renderQuotePdf({ quote, title: "Quote", company: "Alex Packaging" });

    // dry or no hubId => return now
    if (!hubId || url.searchParams.get("dry") === "1") {
      return NextResponse.json({
        ok: true,
        step: "dry",
        quotingMode: hubId ? "unknown" : "local_only",
        pdfBytes: pdf.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    }

    // compute quoting mode from caps (cached)
    let quotingMode = "local_only";
    try {
      const caps = await fetchCaps(hubId);
      quotingMode = caps.quotingMode;
    } catch {
      quotingMode = "local_only";
    }

    if (quotingMode === "local_only") {
      return NextResponse.json({
        ok: true,
        step: "dry",
        quotingMode,
        pdfBytes: pdf.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    }

    // upload allowed
    const urlOut = await hsUploadBuffer({
      filename: `quote_${Date.now()}.pdf`,
      buffer: pdf,
      folderPath: "quotes",
      hubId
    });

    return NextResponse.json({
      ok: true,
      step: "upload",
      quotingMode,
      url: urlOut,
      totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
    });

  } catch (e) {
    return NextResponse.json({ ok: false, step: "unknown", error: String(e) }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { fetchCaps } from "@/lib/hubspotCaps.js";
import { renderQuotePdf } from "@/lib/quote-pdf-lib.js";
import { hsUploadBuffer } from "@/lib/hsFiles.js";
import { updateCrmProperty } from "@/lib/hsCrm.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const hubId = url.searchParams.get("hubId") || process.env.HUBSPOT_PORTAL_ID || null;

    // optional CRM target for attaching URL
    const recordType = url.searchParams.get("recordType"); // e.g. "deals"
    const recordId   = url.searchParams.get("recordId");   // e.g. "123456789"
    const propName   = url.searchParams.get("prop") || "last_quote_url";

    // admin guard (keep your existing)
    const adminKey = req.headers.get("x-admin-key");
    if (!adminKey || adminKey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
      return NextResponse.json({ ok: false, step: "auth", error: "unauthorized" }, { status: 401 });
    }

    // parse body (…your pricing, same as before…)
    const payload = await req.json().catch(() => ({}));
    const {
      items = [
        { sku: "FOAM-PE-1_7-2X2", qty: 100 },
        { sku: "CRATE-48x40x36", qty: 10 }
      ],
      customerTierCode = "VIP",
      rush = true,
      shipState = "OH"
    } = payload;

    // demo pricing (unchanged)
    const lines = items.map(i => ({
      sku: i.sku, name: i.sku, qty: Number(i.qty || 0),
      unitPrice: 1, lineSubtotal: Number(i.qty || 0) * 1
    }));
    const subtotal = lines.reduce((s, L) => s + L.lineSubtotal, 0);
    const taxPct = 7.5;
    const taxAmt = +(subtotal * (taxPct / 100)).toFixed(2);
    const total = +(subtotal + taxAmt).toFixed(2);
    const quote = {
      lines, subtotal, taxPct, taxAmt, total,
      orderSurcharge: { percent: 0, flat: 0, amount: 0 },
      meta: { customerTierCode, rush, shipState }
    };

    // render pdf always
    const pdf = await renderQuotePdf({ quote, title: "Quote", company: "Alex Packaging" });

    // dry or no hubId → return now
    if (!hubId || url.searchParams.get("dry") === "1") {
      return NextResponse.json({
        ok: true,
        step: "dry",
        quotingMode: hubId ? "unknown" : "local_only",
        pdfBytes: pdf.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    }

    // caps → mode
    let quotingMode = "local_only";
    try {
      const caps = await fetchCaps(hubId);
      quotingMode = caps.quotingMode;
    } catch {
      quotingMode = "local_only";
    }

    if (quotingMode === "local_only") {
      return NextResponse.json({
        ok: true,
        step: "dry",
        quotingMode,
        pdfBytes: pdf.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    }

    // upload (returns {id,url} or just url depending on your helper)
    const uploaded = await hsUploadBuffer({
      filename: `quote_${Date.now()}.pdf`,
      buffer: pdf,
      folderPath: "quotes",
      hubId
    });
    const fileUrl = uploaded?.url || uploaded; // support old return type

    // ---------- NEW: attach URL to CRM record if provided ----------
    let attached = null;
    if (recordType && recordId && fileUrl) {
      try {
        attached = await updateCrmProperty({
          hubId,
          object: recordType,      // "deals" | "companies" | "contacts"
          id: recordId,
          property: propName,      // defaults to "last_quote_url"
          value: fileUrl
        });
      } catch (e) {
        // don’t fail the whole request if property update fails
        // (likely the property doesn't exist yet)
        attached = { ok: false, error: String(e) };
      }
    }
    // ---------------------------------------------------------------

    return NextResponse.json({
      ok: true,
      step: "upload",
      quotingMode,
      url: fileUrl,
      attached, // details of property update if attempted
      totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
    });

  } catch (e) {
    return NextResponse.json({ ok: false, step: "unknown", error: String(e) }, { status: 500 });
  }
}
