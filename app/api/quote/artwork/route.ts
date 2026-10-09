// app/api/quote/artwork/route.ts
//
// Print artwork for a quote (Corrugated Step 6). Stored in quote_attachments
// with kind = 'artwork' (migration 028).
//
// GET    ?quote_no=Q-...                -> { ok, locked, files: [{ id, filename, content_type, size_bytes, created_at, url }] }
// POST   multipart: quote_no, file      -> { ok, file }
// DELETE { quote_no, id }               -> { ok }
//
// Access: the quote number is the credential (same rule as /quote?quote_no=
// and /api/quote-attachments/{id}?quote_no=). Logged-out callers are rate
// limited and can't upload or remove on a locked quote; staff (admin / cs /
// sales) of the quote's own shop are not limited and can.
//
// Files: PDF, AI, EPS, SVG, PNG, JPG, TIFF; 8 MB each; 10 per quote. The
// stored content type comes from the extension. Downloads go through
// /api/quote-attachments/{id}, which only serves PDF and raster images inline.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { ARTWORK_CONTENT_TYPES, ARTWORK_MAX_FILES, artworkExt, artworkProblem } from "@/lib/artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };
type FileRow = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

async function findQuote(quoteNo: string): Promise<QuoteRow | null> {
  if (!quoteNo) return null;
  return one<QuoteRow>(
    `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
}

/** Staff of the quote's own shop. */
async function isShopStaff(req: NextRequest, tenantId: number): Promise<boolean> {
  try {
    const user = await getCurrentUserFromRequest(req);
    return (
      !!user &&
      isRoleAllowed(user, ["admin", "cs", "sales"]) &&
      Number(user.tenant_id) === Number(tenantId)
    );
  } catch {
    return false;
  }
}

function fileOut(r: FileRow, quoteNo: string) {
  return {
    id: r.id,
    filename: r.filename,
    content_type: r.content_type,
    size_bytes: r.size_bytes == null ? null : Number(r.size_bytes),
    created_at: r.created_at,
    url: `/api/quote-attachments/${r.id}?quote_no=${encodeURIComponent(quoteNo)}`,
  };
}

function cleanFilename(name: string): string {
  const base = String(name || "artwork").split(/[\\/]/).pop() || "artwork";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|]/g, "").trim();
  return (cleaned || "artwork").slice(0, 120);
}

export async function GET(req: NextRequest) {
  try {
    const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    const quote = await findQuote(quoteNo);
    if (!quote) return bad("not_found", "Quote not found.", 404);

    if (!(await isShopStaff(req, quote.tenant_id))) {
      const rate = await rateLimit(req, 60, "artwork-get");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const rows = await q<FileRow>(
      `SELECT id, filename, content_type, size_bytes, created_at
         FROM public.quote_attachments
        WHERE quote_id = $1 AND kind = 'artwork'
        ORDER BY created_at ASC, id ASC`,
      [quote.id],
    );

    return json({ ok: true, locked: !!quote.locked, files: (rows || []).map((r) => fileOut(r, quote.quote_no)) });
  } catch (e) {
    console.error("[quote/artwork] GET failed:", e);
    return bad("server_error", "We couldn't load the artwork.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("invalid_body", "Send the file as a form upload.");
    }

    const quoteNo = String(form.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    const quote = await findQuote(quoteNo);
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const staff = await isShopStaff(req, quote.tenant_id);
    if (!staff) {
      const rate = await rateLimit(req, 10, "artwork-post");
      if (!rate.success) return rateLimitResponse(rate.reset);
      if (quote.locked) return bad("locked", "This quote is locked. Email your artwork to us instead.", 409);
    }

    const f = form.get("file");
    if (!f || typeof f !== "object" || typeof (f as File).arrayBuffer !== "function") {
      return bad("missing_file", "Choose a file to upload.");
    }
    const file = f as File;
    const problem = artworkProblem(file.name, file.size);
    if (problem) return bad("invalid_file", problem);

    const count = await one<{ n: string | number }>(
      `SELECT count(*) AS n FROM public.quote_attachments WHERE quote_id = $1 AND kind = 'artwork'`,
      [quote.id],
    );
    if (Number(count?.n ?? 0) >= ARTWORK_MAX_FILES) {
      return bad("too_many_files", `A quote can have up to ${ARTWORK_MAX_FILES} artwork files. Remove one first.`);
    }

    const ext = artworkExt(file.name);
    const contentType = ARTWORK_CONTENT_TYPES[ext] || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());

    const row = await one<FileRow>(
      `INSERT INTO public.quote_attachments
         (quote_id, quote_no, filename, content_type, size_bytes, data, kind)
       VALUES ($1, $2, $3, $4, $5, $6, 'artwork')
       RETURNING id, filename, content_type, size_bytes, created_at`,
      [quote.id, quote.quote_no, cleanFilename(file.name), contentType, buf.length, buf],
    );
    if (!row) return bad("server_error", "We couldn't save the file. Please try again.", 500);

    return json({ ok: true, file: fileOut(row, quote.quote_no) }, 201);
  } catch (e) {
    console.error("[quote/artwork] POST failed:", e);
    return bad("server_error", "We couldn't save the file. Please try again.", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, any> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    const id = Number(b?.id);
    if (!quoteNo || !Number.isInteger(id) || id <= 0) return bad("invalid_body", "quote_no and id are required.");

    const quote = await findQuote(quoteNo);
    if (!quote) return bad("not_found", "Quote not found.", 404);

    if (!(await isShopStaff(req, quote.tenant_id))) {
      const rate = await rateLimit(req, 10, "artwork-delete");
      if (!rate.success) return rateLimitResponse(rate.reset);
      if (quote.locked) return bad("locked", "This quote is locked. Contact us to change the artwork.", 409);
    }

    const gone = await one<{ id: number }>(
      `DELETE FROM public.quote_attachments
        WHERE id = $1 AND quote_id = $2 AND kind = 'artwork'
        RETURNING id`,
      [id, quote.id],
    );
    if (!gone) return bad("not_found", "That file isn't on this quote.", 404);

    return json({ ok: true });
  } catch (e) {
    console.error("[quote/artwork] DELETE failed:", e);
    return bad("server_error", "We couldn't remove the file. Please try again.", 500);
  }
}
