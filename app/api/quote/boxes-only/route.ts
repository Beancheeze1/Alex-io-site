// app/api/quote/boxes-only/route.ts
//
// POST /api/quote/boxes-only — create a priced "Boxes only" quote (Corrugated
// Step 4): no foam, no layout editor. Pricing reuses Step 3:
//   custom RSC   -> corrugated engine with board grade + print (fallback:
//                   nearest stock + needs_review)
//   custom mailer-> nearest stock (+ print adder)
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
//   box: { sku } | { L, W, D, style: "rsc"|"mailer", grade_id? },
//   print_spec?: { colors: ("spot"|"flood")[], sides: 1|2 },
//   notes?
// }
// -> { ok, quote_no, url }

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { resolveTenantFromHost } from "@/lib/tenant";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { findOrCreateCustomer } from "@/app/lib/customers";
import { parsePrintSpec, type PrintSpec } from "@/lib/corrugated-price";
import {
  customSelectionInsert,
  repriceQuoteBoxes,
  resolveCustomSelection,
  resolveStockSelection,
  type StockBoxRow,
} from "@/app/lib/packaging-selection";

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

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    const isStaff = !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
    if (!isStaff) {
      const rate = await rateLimit(req, 10, "boxes-only");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const b = (await req.json().catch(() => null)) as Record<string, any> | null;
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
    const sku = str(box.sku, 80);
    let custom: { L: number; W: number; D: number; style: "rsc" | "mailer"; gradeId: number | null } | null = null;
    if (!sku) {
      const L = Number(box.L);
      const W = Number(box.W);
      const D = Number(box.D);
      if (![L, W, D].every((n) => Number.isFinite(n) && n > 0 && n <= 1000)) {
        return bad("invalid_dims", "Enter the box inside length, width and depth.");
      }
      const style: "rsc" | "mailer" = String(box.style || "").toLowerCase() === "mailer" ? "mailer" : "rsc";
      const g = Number(box.grade_id);
      custom = { L, W, D, style, gradeId: Number.isInteger(g) && g > 0 ? g : null };
    }

    const print: PrintSpec = parsePrintSpec(b.print_spec) ?? { colors: [], sides: 1 };
    const notes = str(b.notes, 2000);

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
    }

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
      ...(custom ? { customer_box_in: { L: custom.L, W: custom.W, H: custom.D, style: custom.style } } : {}),
      ...(notes ? { customer_notes: notes } : {}),
    });

    // ---- Box selection, priced ----
    if (custom) {
      const resolved = await resolveCustomSelection(custom.L, custom.W, custom.D, custom.style, qty, tenantId, {
        gradeId: custom.gradeId,
        print,
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

    return json({ ok: true, quote_no: quote.quote_no, url: `/quote?quote_no=${encodeURIComponent(quote.quote_no)}` });
  } catch (e: any) {
    console.error("[quote/boxes-only] failed:", e);
    return bad("server_error", "We couldn't create the quote. Please try again.", 500);
  }
}
