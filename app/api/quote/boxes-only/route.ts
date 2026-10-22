// app/api/quote/boxes-only/route.ts
//
// POST /api/quote/boxes-only — create a priced "Boxes only" quote (Corrugated
// Step 4): no foam, no layout editor. Pricing reuses Step 3:
//   custom box   -> corrugated engine with board grade + print (fallback:
//                   nearest stock + needs_review). Step 27: any style in
//                   lib/box-styles.ts (die-cut styles add a cutting die)
//   stock carton -> catalog tier price (+ print adder)
//   plates       -> plates_usd per box, shown as one line
// The quote is on the per-color print model (facts.print_spec is always set).
//
// Callers:
//   Start Quote (public): a brand-new Q-A- number from /api/public/quote-number.
//     Name + valid email required. 10/min per IP.
//   Rep form (logged-in admin/cs/sales): the quote row was just created by
//     POST /api/quotes; it must belong to the caller's shop (or the platform
//     owner) and have no items or boxes yet.
//
// Shop: an existing quote's own tenant; else the logged-in user's tenant;
// else a real tenant subdomain; else a valid tenant_slug from the quote
// center (core host); else the host.
//
// Body: {
//   quote_no, tenant_slug?, quote_source?, sales_rep_slug?,
//   customer: { name, email, company?, phone? },
//   qty,
//   box: { sku } | { L, W, D, style, grade_id?, cells_across?, cells_down? },
//        style: rsc | hsc | fol | mailer | tray | pad | partition (Step 27)
//   print_spec?: { colors: ("spot"|"flood")[], sides: 1|2 },
//   qty_breaks?: number[],   // up to 3 more quantities to compare (Step 5)
//   run_method?: "plates" | "digital",  // Step 15, staff only; else auto
//   notes?
// }
// -> { ok, quote_no, url }
//
// Step 39E: the buyer's own die line. Send multipart/form-data with
// `payload` (the JSON body above, without box dims) and `file` (a .dxf, up
// to 5 MB). The file is read automatically (lib/dieline-import.ts,
// buyerDielineParts; Step 39F: or a vector .pdf, lib/dieline-pdf.ts) and kept on the quote:
//   one outline     -> one die-cut part line, qty = qty
//   several outlines -> a display: one part line each (payload.parts =
//                      [{ piece, label, per_display }]), qty = qty displays x
//                      per display, plus an "Assembly and packing" line from
//                      the shop's rates
// Every part is flagged for staff to check the lines (review queue) until
// they confirm them on the admin quote page. A file that can't be read is
// refused with a message; the form offers the shop's spec request page.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { resolveTenantFromHost } from "@/lib/tenant";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addEditGrant } from "@/lib/quote-edit";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { findOrCreateCustomer } from "@/app/lib/customers";
import { parsePrintSpec, parseRunMethod, type PrintSpec } from "@/lib/corrugated-price";
import { addAdminAlert } from "@/lib/admin-alerts";
import { sendNewBoxQuoteEmail } from "@/app/lib/send-quote-email";
import { tenantOffersQuoteType } from "@/lib/quote-types-server";
import { parseCustomBoxInput, type CustomBoxInput } from "@/lib/box-styles";
import {
  customSelectionInsert,
  repriceQuoteBoxes,
  resolveAssemblySelection,
  resolveCustomSelection,
  resolveStockSelection,
  type StockBoxRow,
} from "@/app/lib/packaging-selection";
import { buyerDielineParts, type DielineBlank, type DielineSource } from "@/lib/dieline-import"; // Step 39E
import { looksLikePdf, pdfDielineLines } from "@/lib/dieline-pdf"; // Step 39F
import { ASSEMBLY_STYLE } from "@/lib/display-assembly"; // Step 39E

const DIELINE_MAX_BYTES = 5 * 1024 * 1024; // Step 39E

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{1,63}$/;
const NEW_CUSTOMER_QUOTE_RE = /^Q-A-\d{6}-\d{5}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

function str(v: unknown, max = 200): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

type QuoteRow = { id: number; quote_no: string; tenant_id: number };

// The request body as JSON (Step 39E: also the form's `payload`).
async function readJson(req: NextRequest) {
  return (await req.json().catch(() => null)) as Record<string, any> | null;
}

export async function POST(req: NextRequest) {
  // Step 14: on a failure part-way through, remove what this request wrote.
  let cleanupQuoteId: number | null = null;
  let createdQuoteHere = false;
  try {
    const user = await getCurrentUserFromRequest(req);
    const isStaff = !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
    if (!isStaff) {
      const rate = await rateLimit(req, 10, "boxes-only");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    // Step 39E: JSON, or a form with `payload` (the same JSON) + `file` (a die line).
    type Body = NonNullable<Awaited<ReturnType<typeof readJson>>>;
    let b: Body | null = null;
    let dielineFile: { name: string; bytes: Buffer } | null = null;
    if ((req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) return bad("invalid_body", "Expected a form upload.");
      try {
        b = JSON.parse(String(form.get("payload") || ""));
      } catch {
        b = null;
      }
      const f = form.get("file");
      if (f && typeof f === "object" && "arrayBuffer" in f) {
        const file = f as File;
        const fname = String(file.name || "dieline.dxf").slice(0, 200);
        if (!/\.(dxf|pdf)$/i.test(fname)) return bad("not_dxf", "Upload your die line as a .dxf file or a vector .pdf.");
        if (file.size > DIELINE_MAX_BYTES) return bad("too_big", "That file is over 5 MB.");
        dielineFile = { name: fname, bytes: Buffer.from(await file.arrayBuffer()) };
      }
    } else {
      b = await readJson(req);
    }
    if (!b || typeof b !== "object") return bad("invalid_body", "Expected a JSON body.");

    const quoteNo = str(b.quote_no, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    // ---- Customer ----
    const c = (b.customer && typeof b.customer === "object" ? b.customer : {}) as Record<string, unknown>;
    const name = str(c.name, 120);
    const email = str(c.email, 200);
    const company = str(c.company, 120);
    const phone = str(c.phone, 40);
    if (!name) return bad("missing_name", "Enter a name for the quote.");
    if (!isStaff && !email) return bad("missing_email", "Enter an email so we can save your quote.");
    if (email && !EMAIL_RE.test(email)) return bad("invalid_email", "Enter a valid email address.");

    // ---- Quantity ----
    const qty = Number(b.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10_000_000) {
      return bad("invalid_qty", "Enter a whole-number quantity from 1 to 10,000,000.");
    }

    // ---- Box ----
    const box = (b.box && typeof b.box === "object" ? b.box : {}) as Record<string, any>;
    const sku = dielineFile ? null : str(box.sku, 80);
    let custom: (CustomBoxInput & { gradeId: number | null }) | null = null;
    // Step 39E: the buyer's die line -> part(s), read before any quote row is made.
    let dieline: { parts: DielineBlank[]; display: boolean; gradeId: number | null } | null = null;
    if (dielineFile) {
      // Step 39F: a vector PDF is read into the same lines a DXF gives
      let src: DielineSource = dielineFile.bytes.toString("utf8");
      if (/\.pdf$/i.test(dielineFile.name) || looksLikePdf(dielineFile.bytes)) {
        const pdf = await pdfDielineLines(dielineFile.bytes);
        if (!pdf.ok) {
          return bad("dieline_unreadable", `${pdf.message} You can send the file to the shop instead and they'll quote it.`, 422);
        }
        src = pdf.lines;
      }
      const read = buyerDielineParts(src, dielineFile.name, Array.isArray(b.parts) ? b.parts.slice(0, 50) : []);
      if (!read.ok) {
        return bad("dieline_unreadable", `${read.message} You can send the file to the shop instead and they'll quote it.`, 422);
      }
      const g = Number(box.grade_id);
      // Step 39H: staff (the Start a quote form) check the lines themselves, so their parts aren't flagged.
      const parts = isStaff
        ? read.parts.map((p) => {
            const own: DielineBlank = { ...p };
            delete own.check;
            return own;
          })
        : read.parts;
      dieline = { parts, display: read.display, gradeId: Number.isInteger(g) && g > 0 ? g : null };
    } else if (!sku) {
      // Step 27: any style (pads have no depth; partitions need cells).
      const parsed = parseCustomBoxInput(box);
      if (!parsed.ok) return bad("invalid_dims", parsed.message);
      const g = Number(box.grade_id);
      custom = { ...parsed.value, gradeId: Number.isInteger(g) && g > 0 ? g : null };
    }

    const print: PrintSpec = parsePrintSpec(b.print_spec) ?? { colors: [], sides: 1 };
    // Step 15: only staff choose plates vs digital; buyers are always auto.
    const runMethod = isStaff ? parseRunMethod(b.run_method) : null;
    const notes = str(b.notes, 2000);

    // Quantity breaks (Step 5): the ordered qty plus up to 3 more, ascending.
    const extraBreaks: number[] = [];
    if (Array.isArray(b.qty_breaks)) {
      for (const v of b.qty_breaks) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 10_000_000 && n !== qty && !extraBreaks.includes(n)) {
          extraBreaks.push(n);
        }
        if (extraBreaks.length >= 3) break;
      }
    }
    const qtyBreaks = [qty, ...extraBreaks].sort((x, y) => x - y);

    // ---- Quote row + shop ----
    let quote = await one<QuoteRow>(
      `SELECT id, quote_no, tenant_id FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    let tenantId: number;

    if (quote) {
      // Rep form: the row was just created by POST /api/quotes.
      if (!isStaff || (Number(quote.tenant_id) !== Number(user!.tenant_id) && !isPlatformOwner(user))) {
        return bad("quote_exists", "That quote number is already in use. Please start again.", 409);
      }
      const used = await one<{ n: string | number }>(
        `SELECT (SELECT count(*) FROM public.quote_items WHERE quote_id = $1)
              + (SELECT count(*) FROM public.quote_box_selections WHERE quote_id = $1) AS n`,
        [quote.id],
      );
      if (Number(used?.n ?? 0) > 0) {
        return bad("quote_not_empty", "That quote already has items. Start a new quote for boxes only.", 409);
      }
      tenantId = Number(quote.tenant_id);
    } else {
      if (!isStaff && !NEW_CUSTOMER_QUOTE_RE.test(quoteNo)) {
        return bad("invalid_quote_no", "Invalid quote number. Please start again.");
      }
      if (isStaff) {
        tenantId = Number(user!.tenant_id);
      } else {
        const fromHeader = (req.headers.get("x-tenant-slug") || "").trim().toLowerCase();
        const fromBody = (str(b.tenant_slug, 63) || "").toLowerCase();
        const slug =
          fromHeader && fromHeader !== "default" ? fromHeader : SLUG_RE.test(fromBody) ? fromBody : fromHeader;
        const t = slug
          ? await one<{ id: number }>(`SELECT id FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`, [slug])
          : await resolveTenantFromHost(req.headers.get("host"));
        if (!t) return bad("tenant_not_found", "Shop not found.", 404);
        tenantId = Number(t.id);
      }
    }

    // Step 11: the shop must offer boxes-only quotes.
    if (!(await tenantOffersQuoteType(tenantId, "boxes_only"))) {
      return bad("quote_type_unavailable", "This shop doesn't offer boxes-only quotes.", 403);
    }

    // ---- Stock carton (validated before any quote row is created) ----
    let stockBox: StockBoxRow | null = null;
    if (sku) {
      stockBox = await one<StockBoxRow>(
        `SELECT id, sku, vendor, style, description, inside_length_in, inside_width_in, inside_height_in
           FROM public.boxes
          WHERE sku = $1 AND (tenant_id IS NULL OR tenant_id = $2)
          LIMIT 1`,
        [sku, tenantId],
      );
      if (!stockBox) return bad("box_not_found", "That stock box isn't available. Pick another or use your own size.");
    }

    // ---- Create the quote (Start Quote path) ----
    if (!quote) {
      const customer = await findOrCreateCustomer(tenantId, { name, email, phone, company });
      const quoteSource = b.quote_source === "embed_website" ? "embed_website" : "direct";
      quote = await one<QuoteRow>(
        `INSERT INTO public.quotes
           (tenant_id, quote_no, status, customer_name, email, phone, company,
            locked, is_demo, quote_source, updated_by_user_id, customer_id)
         VALUES ($1, $2, 'applied', $3, $4, $5, $6, false, false, $7, $8, $9)
         ON CONFLICT (quote_no) DO NOTHING
         RETURNING id, quote_no, tenant_id`,
        [tenantId, quoteNo, name, email, phone, company, quoteSource, user?.id ?? null, customer?.id ?? null],
      );
      if (!quote) return bad("quote_exists", "That quote number is already in use. Please start again.", 409);
      createdQuoteHere = true;
    }
    cleanupQuoteId = quote.id;

    // ---- Sales rep credit (same rule as layout/apply: only if unset) ----
    const repSlug = str(b.sales_rep_slug, 60);
    if (repSlug) {
      try {
        const rep = await one<{ id: number }>(
          `SELECT id FROM users WHERE tenant_id = $1 AND sales_slug = $2 LIMIT 1`,
          [tenantId, repSlug],
        );
        if (rep?.id) {
          await q(
            `UPDATE quotes SET sales_rep_id = $1 WHERE id = $2 AND tenant_id = $3 AND sales_rep_id IS NULL`,
            [rep.id, quote.id, tenantId],
          );
        }
      } catch (e) {
        console.warn("[boxes-only] sales_rep_slug skipped", { quoteNo, err: String(e) });
      }
    }

    // ---- Facts: per-color print model + boxes-only marker ----
    const prev = (await loadFacts(quote.quote_no)) || {};
    await saveFacts(quote.quote_no, {
      ...(prev as any),
      pack_type: "boxes_only",
      qty,
      print_spec: print,
      printed: print.colors.length > 0 ? 1 : 0,
      ...(runMethod ? { run_method: runMethod } : {}),
      ...(custom ? { customer_box_in: { L: custom.L, W: custom.W, H: custom.D, style: custom.style } } : {}),
      // Step 39E: one part from a die line, or a display (qty = displays)
      ...(dieline && !dieline.display
        ? { customer_box_in: { L: dieline.parts[0].length_in, W: dieline.parts[0].width_in, H: 0, style: "dieline" } }
        : {}),
      ...(dieline?.display ? { display: { displays: qty } } : {}),
      ...(notes ? { customer_notes: notes } : {}),
      ...(qtyBreaks.length > 1 ? { box_qty_breaks: qtyBreaks } : {}),
    });

    // ---- Box selection, priced ----
    if (dieline && dielineFile) {
      // Step 39E: keep the file on the quote, then one line per part (+ assembly for a display).
      const att = await one<{ id: number }>(
        `INSERT INTO public.quote_attachments (quote_id, quote_no, filename, content_type, size_bytes, data, kind)
         VALUES ($1, $2, $3, $4, $5, $6, 'dieline')
         RETURNING id`,
        [
          quote.id,
          quote.quote_no,
          dielineFile.name,
          /\.pdf$/i.test(dielineFile.name) ? "application/pdf" : "application/dxf",
          dielineFile.bytes.length,
          dielineFile.bytes,
        ],
      );
      for (const part0 of dieline.parts) {
        const part: DielineBlank = { ...part0, attachment_id: att ? Number(att.id) : null };
        const lineQty = dieline.display ? qty * (part.per_display ?? 1) : qty;
        const resolved = await resolveCustomSelection(part.length_in, part.width_in, 0, "dieline", lineQty, tenantId, {
          gradeId: dieline.gradeId,
          print,
          method: runMethod,
          dieline: part,
        });
        const ins = customSelectionInsert({
          quoteId: quote.id,
          quoteNo: quote.quote_no,
          L: part.length_in,
          W: part.width_in,
          H: 0,
          style: "dieline",
          qty: lineQty,
          resolved,
          dieline: part,
        });
        await q(ins.text, ins.values);
      }
      if (dieline.display) {
        const perDisplay = dieline.parts.reduce((n, p) => n + (p.per_display ?? 1), 0);
        const resolved = await resolveAssemblySelection(tenantId, qty, perDisplay, {});
        const ins = customSelectionInsert({
          quoteId: quote.id,
          quoteNo: quote.quote_no,
          L: 0,
          W: 0,
          H: 0,
          style: ASSEMBLY_STYLE,
          qty,
          resolved,
          dieline: {},
        });
        await q(ins.text, ins.values);
      }
    } else if (custom) {
      const resolved = await resolveCustomSelection(custom.L, custom.W, custom.D, custom.style, qty, tenantId, {
        gradeId: custom.gradeId,
        print,
        method: runMethod,
        cells: custom.cells,
      });
      const ins = customSelectionInsert({
        quoteId: quote.id,
        quoteNo: quote.quote_no,
        L: custom.L,
        W: custom.W,
        H: custom.D,
        style: custom.style,
        qty,
        resolved,
        cells: custom.cells,
      });
      await q(ins.text, ins.values);
    } else if (stockBox) {
      const base = await resolveStockSelection(stockBox, qty);
      await q(
        `INSERT INTO public.quote_box_selections
           (quote_id, quote_no, kind, box_id, sku, qty, description, unit_price_usd, extended_price_usd)
         VALUES ($1, $2, 'stock', $3, $4, $5, $6, $7, $8)`,
        [quote.id, quote.quote_no, stockBox.id, stockBox.sku, qty, base.description, base.unit_price_usd, base.extended_price_usd],
      );
      // Adds the print adder + plates (and records the per-color print fields).
      await repriceQuoteBoxes(quote.id, tenantId, print);
    }

    // Step 7: alert the shop about a buyer's new quote (rep-made quotes don't alert).
    if (!isStaff) {
      await addAdminAlert({
        tenantId: Number(quote.tenant_id),
        quoteNo: quote.quote_no,
        kind: "new_quote",
        title: dieline ? "New quote from a die line" : "New boxes-only quote",
        detail: [
          name,
          company,
          dieline?.display
            ? `${qty.toLocaleString("en-US")} displays, ${dieline.parts.length} parts`
            : `${qty.toLocaleString("en-US")} ${dieline ? "parts" : "boxes"}`,
          print.colors.length ? "printed" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    // Step 37J: email the buyer their quote (with their private link to
    // accept it), the way a foam quote is emailed. Not for rep-made quotes;
    // never fails the request.
    if (!isStaff && createdQuoteHere && email) {
      await sendNewBoxQuoteEmail(quote.quote_no, tenantId);
    }

    const done = json({ ok: true, quote_no: quote.quote_no, url: `/quote?quote_no=${encodeURIComponent(quote.quote_no)}` });
    // Step 21: the browser that started the quote may keep changing it.
    if (createdQuoteHere) addEditGrant(done, req, quote.quote_no);
    return done;
  } catch (e: any) {
    console.error("[quote/boxes-only] failed:", e);
    if (cleanupQuoteId != null) {
      try {
        await q(`DELETE FROM public.quote_box_selections WHERE quote_id = $1`, [cleanupQuoteId]);
        if (createdQuoteHere) await q(`DELETE FROM public.quote_attachments WHERE quote_id = $1 AND kind = 'dieline'`, [cleanupQuoteId]); // Step 39E
        if (createdQuoteHere) {
          await q(
            `DELETE FROM public.quotes q0
              WHERE q0.id = $1
                AND NOT EXISTS (SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = q0.id)`,
            [cleanupQuoteId],
          );
        }
      } catch (ce) {
        console.error("[quote/boxes-only] cleanup after failure failed:", ce);
      }
    }
    return bad("server_error", "We couldn't create the quote. Please try again.", 500);
  }
}
