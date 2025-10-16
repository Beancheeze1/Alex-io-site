// app/api/hubspot/webhook/route.js
import crypto from "crypto";
import { NextResponse } from "next/server";

import { fetchCaps } from "@/lib/hubspotCaps.js";
import { renderQuotePdf } from "@/lib/quote-pdf-lib.js";
import { hsUploadBuffer } from "@/lib/hsFiles.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional webhook signature verification (v3).
 * Enable by setting HUBSPOT_WEBHOOK_SECRET to your app secret.
 * Docs: https://developers.hubspot.com/docs/api/webhooks/validating-requests
 */
function verifyHubSpotSignature({ method, url, body, secret, signature }) {
  if (!secret) return true; // verification disabled
  if (!signature) return false;
  const base = `${method}${url}${body}`;
  const digest = crypto.createHmac("sha256", secret).update(base).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

/**
 * Very simple event -> items extractor.
 * Tailor this to your actual subscriptions. If no items found,
 * we fall back to a demo quote so the pipeline still runs.
 */
function extractItemsFromEvents(events) {
  const items = [];

  for (const ev of Array.isArray(events) ? events : []) {
    // Example: you subscribed to product events or line item property changes
    // Shape varies by subscription; adapt as needed.

    // If your event contains a line item SKU and qty
    const sku = ev?.properties?.sku || ev?.sku;
    const qty = Number(ev?.properties?.quantity ?? ev?.qty ?? 0);

    if (sku && qty > 0) items.push({ sku, qty });
  }

  // Fallback demo so you can see end-to-end behavior even if events don’t match yet
  if (items.length === 0) {
    items.push({ sku: "FOAM-PE-1_7-2X2", qty: 100 });
    items.push({ sku: "CRATE-48x40x36", qty: 10 });
  }

  return items;
}

/**
 * Calls your internal pricing endpoint to compute a quote.
 * Adjust the endpoint/body to match your actual pricing API.
 */
async function priceItems({ items, customerTierCode = "VIP", rush = true, shipState = "OH" }) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_URL ?? ""}/api/quote/price`, {
    // For dev, relative fetch also works: new URL("/api/quote/price", req.url)
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, customerTierCode, rush, shipState }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.quote) {
    throw new Error(`pricing failed ${res.status}: ${JSON.stringify(data)}`);
  }
  return data.quote; // expect { lines, subtotal, taxPct, taxAmt, total, orderSurcharge }
}

export async function GET() {
  // Simple health check
  return NextResponse.json({ ok: true, route: "/api/hubspot/webhook" });
}

export async function POST(req) {
  const url = new URL(req.url);

  // 1) Optional signature verification (recommended in prod)
  const secret = process.env.HUBSPOT_WEBHOOK_SECRET || process.env.HUBSPOT_CLIENT_SECRET || "";
  const sig = req.headers.get("x-hubspot-signature-v3"); // v3
  const method = "POST";
  const bodyText = await req.text(); // must read raw body to verify
  const fullUrl = url.toString();

  if (!verifyHubSpotSignature({ method, url: fullUrl, body: bodyText, secret, signature: sig })) {
    return NextResponse.json({ ok: false, step: "auth", error: "invalid signature" }, { status: 401 });
  }

  // 2) Parse events
  let events;
  try {
    events = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ ok: false, step: "parse", error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ ok: false, step: "events", error: "no events" }, { status: 400 });
  }

  // 3) Resolve hubId to pick the right OAuth token (or fall back to PAT)
  //    For dev, pass ?hubId=... in your webhook URL inside HubSpot (Subscription settings)
  const hubId = url.searchParams.get("hubId") || process.env.HUBSPOT_PORTAL_ID || null;
  if (!hubId) {
    return NextResponse.json({ ok: false, step: "auth", error: "hubId required (query or env)" }, { status: 400 });
  }

  // 4) Check capabilities → quotingMode (cached)
  let quotingMode = "local_only";
  try {
    const caps = await fetchCaps(hubId);
    quotingMode = caps.quotingMode;
  } catch (e) {
    // If caps fetch fails, continue in local_only so you still get a PDF in logs
    quotingMode = "local_only";
  }

  try {
    // 5) Build items from events → price → quote
    const items = extractItemsFromEvents(events);
    const quote = await priceItems({ items });

    // 6) Render PDF (always)
    const pdf = await renderQuotePdf({ quote, title: "Quote", company: "Alex Packaging" });

    // 7) Upload only if mode allows
    if (quotingMode === "local_only") {
      return NextResponse.json({
        ok: true,
        step: "dry",
        quotingMode,
        pdfBytes: pdf.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total },
      });
    }

    const urlOut = await hsUploadBuffer({
      filename: `quote_${Date.now()}.pdf`,
      buffer: pdf,
      folderPath: "quotes",
      hubId, // uses OAuth token for this portal; falls back to PAT if none
    });

    return NextResponse.json({
      ok: true,
      step: "upload",
      quotingMode,
      url: urlOut,
      totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, step: "unknown", error: String(e) }, { status: 500 });
  }
}
