// app/api/quote-attachments/[id]/route.ts
//
// Attachment download by id.
//
// Access requires ONE of:
//   (A) a logged-in admin / cs / sales user whose tenant owns the
//       attachment's quote (admin quote page, Attachments panel), or
//   (B) ?quote_no= matching the attachment's own quote_no (public layout
//       editor flow: the quote number is the same credential that already
//       opens /quote?quote_no=).
// Every other request gets the same 404 as a missing id, so ids can't be
// probed. Public (B) requests are rate limited per IP.
//
// Responses are nosniff. Only safe types (PDF, raster images, JSON) are
// served inline; everything else (SVG, HTML, CAD, unknown) downloads as an
// attachment so uploaded content can never run as a page on this origin.
//
// Used by the editor to fetch forge_faces.json / normalized.dxf, and by the
// admin quote page's Attachments panel.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MetaRow = {
  id: number;
  quote_no: string | null;
  quote_tenant_id: number | null;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

type DataRow = { data: Buffer };

const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/json",
]);

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

function notFound() {
  return err("not_found", "Attachment not found.", 404);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    let raw = "";
    try {
      const p = await ctx.params;
      raw = String(p?.id ?? "").trim();
    } catch {}

    // Fallback: derive from pathname if params are missing in the runtime
    if (!raw) {
      try {
        const parts = new URL(req.url).pathname.split("/").filter(Boolean);
        raw = String(parts[parts.length - 1] ?? "").trim();
      } catch {}
    }

    // Allow only a clean leading integer
    const m = /^(\d+)/.exec(raw);
    const id = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      return err("invalid_id", "id must be a positive number");
    }

    const meta = await one<MetaRow>(
      `
      SELECT qa.id, qa.quote_no, quo.tenant_id AS quote_tenant_id,
             qa.filename, qa.content_type, qa.size_bytes
      FROM public.quote_attachments AS qa
      LEFT JOIN public."quotes" AS quo
        ON quo.id = qa.quote_id
        OR (qa.quote_id IS NULL AND quo.quote_no = qa.quote_no)
      WHERE qa.id = $1
      LIMIT 1;
      `,
      [id],
    );

    if (!meta) return notFound();

    // (A) Staff of the tenant that owns the quote.
    const user = await getCurrentUserFromRequest(req);
    const staffOk =
      !!user &&
      isRoleAllowed(user, ["admin", "cs", "sales"]) &&
      meta.quote_tenant_id != null &&
      Number(meta.quote_tenant_id) === Number(user.tenant_id);

    // (B) Caller knows the attachment's own quote number.
    let publicOk = false;
    if (!staffOk) {
      const qn = (req.nextUrl.searchParams.get("quote_no") || "").trim();
      if (qn) {
        const rate = await rateLimit(req, 60, "quote-attachment-dl");
        if (!rate.success) return rateLimitResponse(rate.reset);
        publicOk = !!meta.quote_no && qn === meta.quote_no.trim();
      }
    }

    if (!staffOk && !publicOk) return notFound();

    const dataRow = await one<DataRow>(
      `SELECT data FROM public.quote_attachments WHERE id = $1 LIMIT 1;`,
      [id],
    );
    if (!dataRow) return notFound();

    if (meta.filename === "forge_faces.json") {
      // MATCH FORGE: return payload exactly as stored. Do NOT translate, snap, or recompute outer.
      // The stored JSON already contains: { units, outerLoopIndex, loops:[{points, area, perimeter, edges...}] }.
      try {
        const faces = JSON.parse(dataRow.data.toString("utf8"));

        // Basic sanity only (no mutation)
        if (!faces || typeof faces !== "object" || !Array.isArray((faces as any).loops)) {
          console.warn("quote-attachments/[id] forge_faces adapter: malformed json; falling back to bytes", {
            id: meta.id,
          });
        } else {
          const headers = new Headers();
          headers.set("Cache-Control", "no-store");
          headers.set("Content-Type", "application/json; charset=utf-8");
          headers.set("X-Content-Type-Options", "nosniff");
          return NextResponse.json(faces, { status: 200, headers });
        }
      } catch (e) {
        console.warn("quote-attachments/[id] forge_faces adapter: parse failed; falling back to bytes", {
          id: meta.id,
          err: String(e),
        });
      }
      // fall through to raw bytes response
    }

    const contentType = (meta.content_type || "application/octet-stream").trim();
    const baseType = contentType.split(";")[0].trim().toLowerCase();
    const inline = INLINE_TYPES.has(baseType);
    const filename = (meta.filename || `attachment-${id}`).replace(/["\r\n]/g, "");

    const headers = new Headers();
    headers.set("Content-Type", inline ? contentType : "application/octet-stream");
    headers.set("Content-Length", String(dataRow.data.length));
    headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");

    return new NextResponse(new Uint8Array(dataRow.data), { status: 200, headers });
  } catch (e: any) {
    console.error("quote-attachments/[id] GET exception:", e);
    return err("attachment_get_exception", "Could not load attachment.", 500);
  }
}
