import { NextResponse } from "next/server";
import { renderQuotePdf } from "@/lib/oauthStore";
import { hsUploadBuffer } from "@/lib/hsFiles.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polyfill (Node 18 usually has these, but add fallback just in case)
try {
  if (!globalThis.Blob) {
    const { Blob } = await import("buffer");
    globalThis.Blob = Blob;
  }
  if (!globalThis.FormData) {
    const { FormData } = await import("undici");
    globalThis.FormData = FormData;
  }
} catch {}

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok:false, status:500, error:"ADMIN_KEY missing" };
  if (sent !== need) return { ok:false, status:401, error:"Unauthorized" };
  return { ok:true };
}

async function priceQuoteLocal(body) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000";
  const r = await fetch(`${base}/api/quote/price`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`PRICE_FAIL ${r.status} ${JSON.stringify(j)}`);
  return j.quote;
}

export async function POST(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json({ ok:false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  try {
    const body = await req.json();
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      return NextResponse.json({ ok:false, error:"items required" }, { status:400 });
    }

    // 1) Pricing
    let quote;
    try {
      quote = await priceQuoteLocal(body);
    } catch (e) {
      return NextResponse.json({ ok:false, step:"pricing", error:String(e) }, { status:500 });
    }

    // 2) PDF
    let pdfBuffer;
    try {
      pdfBuffer = await renderQuotePdf({
        quote,
        title: body.title || "Quote",
        company: body.company || "Your Company",
      });
    } catch (e) {
      return NextResponse.json({ ok:false, step:"pdf", error:String(e) }, { status:500 });
    }

    if (dry) {
      // Skip upload—prove PDF and pricing work
      return NextResponse.json({
        ok:true, step:"dry",
        pdfBytes: pdfBuffer.length,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    }

    // 3) Upload
    try {
      const name = `quote_${Date.now()}.pdf`;
      const url = await hsUploadBuffer({ filename: name, buffer: pdfBuffer, folderPath: "quotes" });
      return NextResponse.json({
        ok:true, step:"upload", url,
        totals: { subtotal: quote.subtotal, tax: quote.taxAmt, total: quote.total }
      });
    } catch (e) {
      return NextResponse.json({ ok:false, step:"upload", error:String(e) }, { status:500 });
    }
  } catch (e) {
    return NextResponse.json({ ok:false, step:"unknown", error:String(e) }, { status:500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok:false, error:"Use POST" }, { status:405 });
}
