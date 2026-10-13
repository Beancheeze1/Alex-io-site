// app/api/quote/boxes-only/multi/route.ts
//
// POST /api/quote/boxes-only/multi — a boxes-only quote with several sizes
// (Step 9A). Same callers, quote-number, shop, rep-credit and alert rules as
// /api/quote/boxes-only (single size, unchanged).
//
// Body: {
//   quote_no, tenant_slug?, quote_source?, sales_rep_slug?,
//   customer: { name, email, company?, phone? },
//   notes?,
//   run_method?: "plates" | "digital",         // Step 15, staff only; else auto
//   boxes: [                                   // 1..10
//     { qty,
//       sku } |
//     { qty,
//       L, W, D, style: "rsc"|"mailer", grade_id? },
//     ...each may also have:
//       print_spec?: { colors: ("spot"|"flood")[], sides: 1|2 },
//       qty_breaks?: number[]                  // up to 3 compare quantities
//   ]
// }
// -> { ok, quote_no, url }
//
// Facts: pack_type "boxes_only", print_mode "per_box" (each row keeps its own
// print_colors / print_sides; no quote-level print_spec), printed (any size
// printed), qty (first size's qty), customer_notes.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { resolveTenantFromHost } from "@/lib/tenant";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { findOrCreateCustomer } from "@/app/lib/customers";
import { parsePrintSpec, parseRunMethod, type PrintSpec } from "@/lib/corrugated-price";
import { addAdminAlert } from "@/lib/admin-alerts";
import { tenantOffersQuoteType } from "@/lib/quote-types-server";
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
const MAX_SIZES = 10;

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

type SizeIn = {
  qty: number;
  sku: string | null;
  custom: { L: number; W: number; D: number; style: "rsc" | "mailer"; gradeId: number | null } | null;
  print: PrintSpec;
  breaks: number[] | null; // qty + up to 3, ascending; null when no compare quantities
};

function parseSize(raw: unknown, index: number): SizeIn | string {
  const n = index + 1;
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;

  const qty = Number(b.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000_000) {
    return `Size ${n}: enter a whole-number quantity from 1 to 10,000,000.`;
  }

  const sku = str(b.sku, 80);
  let custom: SizeIn["custom"] = null;
  if (!sku) {
    const L = Number(b.L);
    const W = Number(b.W);
    const D = Number(b.D);
    if (![L, W, D].every((v) => Number.isFinite(v) && v > 0 && v <= 1000)) {
      return `Size ${n}: enter the box inside length, width and depth.`;
    }
    const style: "rsc" | "mailer" = String(b.style || "").toLowerCase() === "mailer" ? "mailer" : "rsc";
    const g = Number(b.grade_id);
    custom = { L, W, D, style, gradeId: Number.isInteger(g) && g > 0 ? g : null };
  }

  const print: PrintSpec = parsePrintSpec(b.print_spec) ?? { colors: [], sides: 1 };

  const extra: number[] = [];
  if (Array.isArray(b.qty_breaks)) {
    for (const v of b.qty_breaks) {
      const x = Number(v);
      if (Number.isInteger(x) && x >= 1 && x <= 10_000_000 && x !== qty && !extra.includes(x)) extra.push(x);
      if (extra.length >= 3) break;
    }
  }
  const breaks = extra.length ? [qty, ...extra].sort((x, y) => x - y) : null;

  return { qty, sku, custom, print, breaks };
}

export async function POST(req: NextRequest) {
  // Step 14: on a failure part-way through, remove what this request wrote.
  let cleanupQuoteId: number | null = null;
  let createdQuoteHere = false;
  try {
    const user = await getCurrentUserFromRequest(req);
    const isStaff = !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
    if (!isStaff) {
      const rate = await rateLimit(req, 10, "boxes-only-multi");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const b = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!b || typeof b !== "object") return bad("invalid_body", "Expected a JSON body.");

    const quoteNo = str(b.quote_no, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    // Step 15: only staff choose plates vs digital (whole quote); buyers are always auto.
    const runMethod = isStaff ? parseRunMethod(b.run_method) : null;

    // ---- Customer ----
    const c = (b.customer && typeof b.customer === "object" ? b.customer : {}) as Record<string, unknown>;
    const name = str(c.name, 120);
    const email = str(c.email, 200);
    const company = str(c.company, 120);
    const phone = str(c.phone, 40);
    if (!name) return bad("missing_name", "Enter a name for the quote.");
    if (!isStaff && !email) return bad("missing_email", "Enter an email so we can save your quote.");
    if (email && !EMAIL_RE.test(email)) return bad("invalid_email", "Enter a valid email address.");

    // ---- Sizes ----
    if (!Array.isArray(b.boxes) || b.boxes.length === 0) return bad("missing_boxes", "Add at least one box size.");
    if (b.boxes.length > MAX_SIZES) return bad("too_many_boxes", `A quote can have up to ${MAX_SIZES} box sizes.`);
    const sizes: SizeIn[] = [];
    for (let i = 0; i < b.boxes.length; i++) {
      const s = parseSize(b.boxes[i], i);
      if (typeof s === "string") return bad("invalid_box", s);
      sizes.push(s);
    }

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

    // Step 11: the shop must offer boxes-only quotes.
    if (!(await tenantOffersQuoteType(tenantId, "boxes_only"))) {
      return bad("quote_type_unavailable", "This shop doesn't offer boxes-only quotes.", 403);
    }

    // ---- Stock cartons (validated before any quote row is created) ----
    const stockBoxes: (StockBoxRow | null)[] = [];
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i];
      if (!s.sku) {
        stockBoxes.push(null);
        continue;
      }
      const box = await one<StockBoxRow>(
        `SELECT id, sku, vendor, style, description, inside_length_in, inside_width_in, inside_height_in
           FROM public.boxes
          WHERE sku = $1 AND (tenant_id IS NULL OR tenant_id = $2)
          LIMIT 1`,
        [s.sku, tenantId],
      );
      if (!box) return bad("box_not_found", `Size ${i + 1}: that stock box isn't available. Pick another or use your own size.`);
      stockBoxes.push(box);
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

    // ---- Sales rep credit (only if unset) ----
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
        console.warn("[boxes-only/multi] sales_rep_slug skipped", { quoteNo, err: String(e) });
      }
    }

    // ---- Facts: per-size print model ----
    const anyPrinted = sizes.some((s) => s.print.colors.length > 0);
    const prev = (await loadFacts(quote.quote_no)) || {};
    const nextFacts: Record<string, any> = {
      ...(prev as any),
      pack_type: "boxes_only",
      print_mode: "per_box",
      qty: sizes[0].qty,
      printed: anyPrinted ? 1 : 0,
      ...(runMethod ? { run_method: runMethod } : {}),
      ...(notes ? { customer_notes: notes } : {}),
    };
    delete nextFacts.print_spec;
    delete nextFacts.box_qty_breaks;
    await saveFacts(quote.quote_no, nextFacts);

    // ---- One selection row per size ----
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i];
      let rowId: number | null = null;

      if (s.custom) {
        const resolved = await resolveCustomSelection(s.custom.L, s.custom.W, s.custom.D, s.custom.style, s.qty, tenantId, {
          gradeId: s.custom.gradeId,
          print: s.print,
          method: runMethod,
        });
        const ins = customSelectionInsert({
          quoteId: quote.id,
          quoteNo: quote.quote_no,
          L: s.custom.L,
          W: s.custom.W,
          H: s.custom.D,
          style: s.custom.style,
          qty: s.qty,
          resolved,
        });
        const inserted = await q<{ id: number }>(ins.text, ins.values);
        rowId = inserted?.[0]?.id ?? null;
      } else {
        const box = stockBoxes[i]!;
        const base = await resolveStockSelection(box, s.qty);
        const inserted = await q<{ id: number }>(
          `INSERT INTO public.quote_box_selections
             (quote_id, quote_no, kind, box_id, sku, qty, description, unit_price_usd, extended_price_usd,
              print_colors, print_sides)
           VALUES ($1, $2, 'stock', $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           RETURNING id`,
          [
            quote.id,
            quote.quote_no,
            box.id,
            box.sku,
            s.qty,
            base.description,
            base.unit_price_usd,
            base.extended_price_usd,
            JSON.stringify(s.print.colors),
            s.print.sides,
          ],
        );
        rowId = inserted?.[0]?.id ?? null;
      }

      if (rowId != null && s.breaks) {
        await q(`UPDATE public.quote_box_selections SET qty_breaks = $2::jsonb WHERE id = $1`, [
          rowId,
          JSON.stringify(s.breaks),
        ]);
      }
    }

    // Stock rows get their per-size print adder + plates; custom rows are
    // re-resolved with their own print (same result as at insert).
    await repriceQuoteBoxes(quote.id, tenantId, "per_box");

    if (!isStaff) {
      const totalBoxes = sizes.reduce((sum, s) => sum + s.qty, 0);
      await addAdminAlert({
        tenantId,
        quoteNo: quote.quote_no,
        kind: "new_quote",
        title: "New boxes-only quote",
        detail: [
          name,
          company,
          `${sizes.length} size${sizes.length === 1 ? "" : "s"}`,
          `${totalBoxes.toLocaleString("en-US")} boxes`,
          anyPrinted ? "printed" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    return json({ ok: true, quote_no: quote.quote_no, url: `/quote?quote_no=${encodeURIComponent(quote.quote_no)}` });
  } catch (e: any) {
    console.error("[quote/boxes-only/multi] failed:", e);
    if (cleanupQuoteId != null) {
      try {
        await q(`DELETE FROM public.quote_box_selections WHERE quote_id = $1`, [cleanupQuoteId]);
        if (createdQuoteHere) {
          await q(
            `DELETE FROM public.quotes q0
              WHERE q0.id = $1
                AND NOT EXISTS (SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = q0.id)`,
            [cleanupQuoteId],
          );
        }
      } catch (ce) {
        console.error("[quote/boxes-only/multi] cleanup after failure failed:", ce);
      }
    }
    return bad("server_error", "We couldn't create the quote. Please try again.", 500);
  }
}
