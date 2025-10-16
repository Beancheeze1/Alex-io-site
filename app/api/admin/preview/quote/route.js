// /app/api/admin/preview/quote/route.js
import { NextResponse } from "next/server";

// ---- your existing helpers ----
import { renderQuotePdf } from "@/lib/quote-pdf-lib.js";   // your PDF generator
import { getToken } from "@/lib/oauthStore.js";            // returns OAuth bearer for hubId

// ---- new helpers (see bottom if you need reference impls) ----
import { hsUploadBuffer } from "@/lib/hsFiles.js";                // returns { id, url }
import { associateDealToFile } from "@/lib/hubspotAssociations.js"; // associates deal<->file

// Optional: create a Note on the Deal (requires crm.objects.notes.write)
const ENABLE_QUOTE_NOTE = process.env.ENABLE_QUOTE_NOTE === "1";

// Small inline helper to update a single deal property (no extra import needed)
async function setDealProperty({ hubId, dealId, prop, value }) {
  const bearer = getToken(hubId);
  if (!bearer) throw new Error(`No OAuth token for hub ${hubId}`);

  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { [prop]: value },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Deal update failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

// Optional: Note helper (only used if ENABLE_QUOTE_NOTE=1 and you have the scope)
async function createDealNote({ hubId, dealId, text }) {
  const bearer = getToken(hubId);
  if (!bearer) throw new Error(`No OAuth token for hub ${hubId}`);

  // 1) create note
  const noteRes = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: { hs_note_body: text } }),
  });
  const note = await noteRes.json();
  if (!noteRes.ok) throw new Error(`Note create failed: ${noteRes.status} ${JSON.stringify(note)}`);

  // 2) associate note -> deal
  const assocRes = await fetch("https://api.hubapi.com/crm/v4/associations/note/deal/batch/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [{ from: { id: note.id }, to: { id: String(dealId) }, type: "note_to_deal" }],
    }),
  });
  const assoc = await assocRes.json();
  if (!assocRes.ok) throw new Error(`Note assoc failed: ${assocRes.status} ${JSON.stringify(assoc)}`);

  return { noteId: note.id };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/preview/quote?hubId=...&recordType=deals&recordId=...&prop=last_quote_url&dry=1
export async function POST(req) {
  try {
    const url = new URL(req.url);
    const hubId = url.searchParams.get("hubId") || process.env.HUBSPOT_PORTAL_ID;
    const recordType = url.searchParams.get("recordType") || "deals";
    const recordId = url.searchParams.get("recordId"); // required for full run
    const prop = url.searchParams.get("prop") || "last_quote_url";
    const isDry = url.searchParams.get("dry") === "1";

    if (!hubId) {
      return NextResponse.json({ ok: false, error: "Missing hubId" }, { status: 400 });
    }

    // optional admin key gate (keep or remove if you prefer)
    const adminkey = req.headers.get("x-admin-key");
    if (!adminkey || adminkey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
      return NextResponse.json({ ok: false, step: "auth", error: "unauthorized" }, { status: 401 });
    }

    // ---- read posted payload (or demo defaults so you can test quickly) ----
    let body;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if (!body) {
      body = {
        items: [
          { sku: "FOAM-PE-1-7-2X2", qty: 100 },
          { sku: "CRATE-48x40x36", qty: 10 },
        ],
        customerTierCode: "VIP",
        rush: true,
        shipState: "OH",
      };
    }

    // ---- demo pricing calc (replace with your real pricing logic) ----
    const lines = body.items.map((it) => ({
      name: it.sku,
      qty: Number(it.qty || 1),
      unitPrice: 1,               // demo price only!
      lineSubtotal: Number(it.qty || 1) * 1,
    }));
    const subtotal = lines.reduce((s, L) => s + L.lineSubtotal, 0);
    const taxPct = 7.5;
    const taxAmt = Number(((subtotal * taxPct) / 100).toFixed(2));
    const total = Number((subtotal + taxAmt).toFixed(2));

    const quote = {
      lines,
      subtotal,
      taxPct,
      taxAmt,
      total,
      orderSurcharge: { percent: 0, flat: 0, amount: 0 },
      meta: { customerTierCode: body.customerTierCode, rush: body.rush, shipState: body.shipState },
    };

    // ---- render PDF (your real PDF generator) ----
    const pdf = await renderQuotePdf(quote, {
      title: "Quote",
      company: "Alex Packaging",
    });

    // ---- dry run: return totals + pdf size, skip upload/CRM ----
    if (isDry || !recordId || recordType !== "deals") {
      return NextResponse.json({
        ok: true,
        step: isDry ? "dry" : "unknown",
        quotingMode: "local_only",
        pdfBytes: pdf.length,
        totals: {
          subtotal: quote.subtotal,
          tax: quote.taxAmt,
          total: quote.total,
        },
      });
    }

    // ---- FULL RUN: upload file, attach to Deal, set property (and optional Note) ----
    const filename = `quote_${Date.now()}.pdf`;

    // 1) Upload to HubSpot Files (PUBLIC_INDEXABLE)
    const uploaded = await hsUploadBuffer({
      hubId,
      buffer: pdf,
      filename,
      folderPath: "quotes",
    });
    // uploaded: { id, url }

    // 2) Update the deal property with the hosted URL
    await setDealProperty({
      hubId,
      dealId: recordId,
      prop,
      value: uploaded.url,
    });

    // 3) Associate file with the Deal so it shows up in "Attachments"
    await associateDealToFile({
      hubId,
      dealId: recordId,
      fileId: uploaded.id,
    });

    // 4) (Optional) Create a Note with link + totals
    if (ENABLE_QUOTE_NOTE) {
      try {
        await createDealNote({
          hubId,
          dealId: recordId,
          text: `**Quote created**  
URL: ${uploaded.url}  
Total: $${quote.total.toFixed(2)}  
Ship state: ${quote.meta.shipState || "n/a"}`,
        });
      } catch (e) {
        console.error("note create failed:", e);
        // do not block response
      }
    }

    return NextResponse.json({
      ok: true,
      step: "upload",
      url: uploaded.url,
      totals: {
        subtotal: quote.subtotal,
        tax: quote.taxAmt,
        total: quote.total,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
