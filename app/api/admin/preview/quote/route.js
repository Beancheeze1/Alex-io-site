// app/api/admin/preview/quote/route.js
import { NextResponse } from "next/server";
import { fetchCaps, getQuotingMode } from "@/lib/hubspotCaps.js";
import { renderQuotePdf } from "@/lib/quote-pdf-lib.js";
import { hsUploadBuffer } from "@/lib/hsFiles.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/preview/quote?hubId=...&dry=1
//        [&recordType=deals|companies|contacts&recordId=123&prop=last_quote_url]
export async function POST(req) {
  try {
    const url = new URL(req.url);
    const hubId = url.searchParams.get("hubId") || process.env.HUBSPOT_PORTAL_ID || null;

    // --- simple admin guard
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

    // ---- demo pricing; replace with your real pricing call if you have one
    const lines = items.map((i) => ({
      sku: i.sku,
      name: i.sku,
      qty: Number(i.qty || 0),
      unitPrice: 1,
      lineSubtotal: Number(i.qty || 0) * 1
    }));
    const subtotal = lines.reduce((s, L) => s + L.lineSubtotal, 0);
    const taxPct = 7.5; // demo
    const taxAmt = +(subtotal * (taxPct / 100)).toFixed(2);
    const total = +(subtotal + taxAmt).toFixed(2);
    const quote = {
      lines,
      subtotal,
      taxPct,
      taxAmt,
      total,
      orderSurcharge: { percent: 0, flat: 0, amount: 0 },
      meta: { customerTierCode, rush, shipState }
    };

    // Always render a PDF
    const pdf = await renderQuotePdf({
      quote,
      title: "Quote",
      company: "Alex Packaging"
    });

    // DRY mode or no hubId => return totals only
    if (!hubId || url.searchParams.get("dry") === "1") {
      return NextResponse.json({
        ok: true,
        step: "dry",
        quotingMode: "local_only",
        pdfBytes: pdf.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    }

    // Upload the file to HubSpot Files
    const caps = await fetchCaps(hubId).catch(() => null); // not strictly needed here
    const urLOut = await hsUploadBuffer({
      filename: `quote_${Date.now()}.pdf`,
      buffer: pdf,
      folderPath: "quotes",
      hubId
    });

    // If recordId + prop are present, write the URL to that property
    const recordType = url.searchParams.get("recordType");
    const recordId = url.searchParams.get("recordId");
    const prop = url.searchParams.get("prop");
    let attached = null;

    if (recordType && recordId && prop && urLOut?.url) {
      // simple update via HubSpot public API (uses token from oauthStore/private app token)
      // We use fetch directly here to keep the route self-contained.
      const token =
        (await import("@/lib/oauthStore.js")).getToken(hubId) ||
        process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
        "";
      if (token) {
        const r = await fetch(
          `https://api.hubapi.com/crm/v3/objects/${recordType}/${recordId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({ properties: { [prop]: urLOut.url } })
          }
        );
        const j = await r.json().catch(() => ({}));
        attached = r.ok ? { ok: true } : { ok: false, error: j };
      } else {
        attached = { ok: false, error: "no token for hub" };
      }
    }

    return NextResponse.json({
      ok: true,
      step: "upload",
      quotingMode: "pdf_only",
      url: urLOut?.url || null,
      attached,
      totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
