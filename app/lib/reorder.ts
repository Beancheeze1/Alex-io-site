// app/lib/reorder.ts
//
// Step 34B: reorder a released job (rules in app/lib/reorder-core.ts).
//   - reorderInfo(): what the reorder dialog shows (foam sets, box lines,
//     printed?, the approved proof)
//   - createReorder(): copies the job into a new quote at today's prices:
//       quote (buyer, customer, rep, ship-to and terms; reorder_of = old no.),
//       foam lines and the released layout (new quantity, saved prices cleared),
//       box lines (new quantities, then repriced now),
//       the buyer's artwork and other files, and, unless the artwork changed,
//       the approved proof as an approved v1,
//       the quote facts (spec only; see reorderFacts)
//     The new quote is an estimate: the buyer accepts it and the shop
//     confirms it as usual. It shows as "New, not opened" in the review queue,
//     and the shop gets a "Reorder" alert when the buyer started it.
// Staff reorders get an R- number; buyer reorders an A- number.

import { one, q, withTxn } from "@/lib/db";
import { newUniqueQuoteNo } from "@/lib/quote-no-server";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { repriceQuoteBoxes } from "@/app/lib/packaging-selection";
import { addAdminAlert } from "@/lib/admin-alerts";
import { loadProofs, quotePrinted } from "@/app/lib/proofs";
import { itemQty, reorderFacts, type ReorderInput, type ReorderSource } from "@/app/lib/reorder-core";

type SrcQuote = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };

export type ReorderInfo = {
  quote_no: string;
  foam: { sets: number; label: string } | null;
  boxes: { id: number; qty: number; label: string }[];
  printed: boolean;
  proof_version: number | null; // the approved proof that would carry over
};

type ItemRow = {
  id: number;
  product_id: number | null;
  length_in: string;
  width_in: string;
  height_in: string;
  material_id: number | null;
  material_name: string | null;
  qty: number;
  notes: string | null;
};

const isLayer = (n: string | null) => String(n || "").toUpperCase().includes("[LAYOUT-LAYER]");
const isPackaging = (n: string | null) => /Requested shipping carton|\[PACKAGING\]/.test(String(n || ""));
const num = (v: unknown) => String(Number(Number(v).toFixed(4)));

async function srcQuote(quoteNo: string, tenantId: number): Promise<SrcQuote | null> {
  return one<SrcQuote>(
    `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE upper(quote_no) = upper($1) AND tenant_id = $2 LIMIT 1`,
    [quoteNo, tenantId],
  );
}

async function items(quoteId: number): Promise<ItemRow[]> {
  return q<ItemRow>(
    `SELECT qi.id, qi.product_id, qi.length_in, qi.width_in, qi.height_in, qi.material_id, m.name AS material_name, qi.qty, qi.notes
       FROM public.quote_items qi LEFT JOIN public.materials m ON m.id = qi.material_id
      WHERE qi.quote_id = $1 ORDER BY qi.id ASC`,
    [quoteId],
  );
}

async function boxRows(quoteId: number) {
  return q<{ id: number; qty: number; description: string | null; sku: string | null }>(
    `SELECT qbs.id, qbs.qty, COALESCE(qbs.description, b.description) AS description, qbs.sku
       FROM public.quote_box_selections qbs LEFT JOIN public.boxes b ON b.id = qbs.box_id
      WHERE qbs.quote_id = $1 ORDER BY qbs.id ASC`,
    [quoteId],
  );
}

export type InfoResult = { ok: true; info: ReorderInfo; source: ReorderSource } | { ok: false; status: number; error: string; message: string };

export async function reorderInfo(quoteNo: string, tenantId: number): Promise<InfoResult> {
  const src = await srcQuote(quoteNo, tenantId);
  if (!src) return { ok: false, status: 404, error: "not_found", message: "Quote not found." };
  if (!src.locked) return { ok: false, status: 409, error: "NOT_RELEASED", message: "Only orders that went into production can be reordered." };
  const [its, boxes, printed, proofs] = await Promise.all([items(src.id), boxRows(src.id), quotePrinted(src.id, src.quote_no), loadProofs(src.id, src.quote_no)]);
  const primary = its.find((it) => !isLayer(it.notes) && !isPackaging(it.notes));
  const approved = proofs.filter((p) => p.status === "approved").sort((a, b) => b.version - a.version)[0];
  const info: ReorderInfo = {
    quote_no: src.quote_no,
    foam: primary
      ? {
          sets: Number(primary.qty) || 1,
          label: `${num(primary.length_in)} x ${num(primary.width_in)} x ${num(primary.height_in)} in${primary.material_name ? `, ${primary.material_name}` : ""}`,
        }
      : null,
    boxes: boxes.map((b) => ({ id: Number(b.id), qty: Number(b.qty) || 1, label: b.description || b.sku || `Box line ${b.id}` })),
    printed,
    proof_version: approved ? approved.version : null,
  };
  return {
    ok: true,
    info,
    source: { foamSets: info.foam ? info.foam.sets : null, boxes: info.boxes.map((b) => ({ id: b.id, qty: b.qty })) },
  };
}

export type CreateResult = { ok: true; quote_no: string; quote_id: number } | { ok: false; status: number; error: string; message: string };

export async function createReorder(args: {
  tenantId: number;
  srcQuoteNo: string;
  input: ReorderInput;
  by: "buyer" | "staff";
  byName?: string | null;
}): Promise<CreateResult> {
  const src = await srcQuote(args.srcQuoteNo, args.tenantId);
  if (!src) return { ok: false, status: 404, error: "not_found", message: "Quote not found." };
  if (!src.locked) return { ok: false, status: 409, error: "NOT_RELEASED", message: "Only orders that went into production can be reordered." };

  const [srcItems, srcFacts, proofs] = await Promise.all([
    items(src.id),
    loadFacts(src.quote_no).catch(() => ({}) as Record<string, unknown>),
    loadProofs(src.id, src.quote_no),
  ]);
  const primary = srcItems.find((it) => !isLayer(it.notes) && !isPackaging(it.notes));
  const oldFoam = primary ? Number(primary.qty) || null : null;
  const newFoam = primary ? args.input.foamQty : null;
  const approved = args.input.artworkChanged ? undefined : proofs.filter((p) => p.status === "approved").sort((a, b) => b.version - a.version)[0];
  const boxQty = new Map(args.input.boxes.map((b) => [b.id, b.qty]));
  const newNo = await newUniqueQuoteNo(args.by === "staff" ? "R" : "A");

  const newId = await withTxn(async (tx) => {
    const ins = await tx.query<{ id: number }>(
      `INSERT INTO public.quotes (tenant_id, quote_no, customer_name, email, phone, company, status, sales_rep_id, is_rush, qty, customer_id, quote_source)
       SELECT tenant_id, $2, customer_name, email, phone, company, 'draft', sales_rep_id, false, $3, customer_id, quote_source
         FROM public.quotes WHERE id = $1
       RETURNING id`,
      [src.id, newNo, newFoam],
    );
    const id = Number(ins.rows[0].id);

    await tx.query(
      `UPDATE public.quotes n
          SET reorder_of = $2,
              freight_terms = s.freight_terms, freight_account = s.freight_account,
              ship_to_name = s.ship_to_name, ship_to_company = s.ship_to_company,
              ship_to_line1 = s.ship_to_line1, ship_to_line2 = s.ship_to_line2,
              ship_to_city = s.ship_to_city, ship_to_state = s.ship_to_state, ship_to_zip = s.ship_to_zip
         FROM public.quotes s
        WHERE n.id = $1 AND s.id = $3`,
      [id, src.quote_no, src.id],
    );

    for (const it of srcItems) {
      await tx.query(
        `INSERT INTO public.quote_items (quote_id, product_id, length_in, width_in, height_in, material_id, qty, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, it.product_id, it.length_in, it.width_in, it.height_in, it.material_id, itemQty({ qty: Number(it.qty), isPackaging: isPackaging(it.notes) }, oldFoam, newFoam), it.notes],
      );
    }

    await tx.query(
      `INSERT INTO public.quote_layout_packages (quote_id, layout_json, notes, svg_text, dxf_text, step_text)
       SELECT $1, layout_json,
              $2::text || COALESCE(NULLIF(trim(regexp_replace(COALESCE(notes, ''), '^(\\s*\\[REV:[^\\]]+\\]\\s*)+', '')), 'RELEASED'), ''),
              svg_text, dxf_text, step_text
         FROM public.quote_layout_packages
        WHERE quote_id = $3
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [id, `[REORDER of ${src.quote_no}] `, src.id],
    );

    await tx.query(
      `INSERT INTO public.quote_box_selections
         (quote_id, quote_no, kind, box_id, sku, custom_length_in, custom_width_in, custom_height_in, custom_style,
          description, qty, board_grade_id, board_grade_name, print_colors, print_sides,
          custom_cells_across, custom_cells_down)
       SELECT $1, $2, s.kind, s.box_id, s.sku, s.custom_length_in, s.custom_width_in, s.custom_height_in, s.custom_style,
              s.description, x.qty, s.board_grade_id, s.board_grade_name, s.print_colors, s.print_sides,
              s.custom_cells_across, s.custom_cells_down
         FROM public.quote_box_selections s
         JOIN unnest($4::bigint[], $5::int[]) AS x(id, qty) ON x.id = s.id
        WHERE s.quote_id = $3 AND x.qty > 0
        ORDER BY s.id`,
      [id, newNo, src.id, [...boxQty.keys()], [...boxQty.values()]],
    );

    // The buyer's files (artwork, sketches, drawings), not the proofs.
    await tx.query(
      `INSERT INTO public.quote_attachments (quote_id, quote_no, filename, content_type, size_bytes, data, kind)
       SELECT $1, $2, filename, content_type, size_bytes, data, kind
         FROM public.quote_attachments
        WHERE quote_id = $3
          AND COALESCE(kind, '') NOT IN ('proof', 'proof_markup')
          AND ($4::boolean = false OR COALESCE(kind, '') <> 'artwork')
        ORDER BY id`,
      [id, newNo, src.id, args.input.artworkChanged],
    );

    if (approved?.file) {
      const att = await tx.query<{ id: number }>(
        `INSERT INTO public.quote_attachments (quote_id, quote_no, filename, content_type, size_bytes, data, kind)
         SELECT $1, $2, filename, content_type, size_bytes, data, 'proof'
           FROM public.quote_attachments WHERE id = $3
         RETURNING id`,
        [id, newNo, approved.file.id],
      );
      if (att.rows[0]) {
        await tx.query(
          `INSERT INTO public.quote_proofs
             (quote_id, tenant_id, version, attachment_id, note, status, sent_by, sent_at, response_at, response_name, response_comment, response_by_staff)
           VALUES ($1, $2, 1, $3, $4, 'approved', $5, $6, $7, $8, NULL, $9)`,
          [
            id,
            args.tenantId,
            Number(att.rows[0].id),
            `Approved artwork from ${src.quote_no} (proof v${approved.version}).`,
            approved.sent_by,
            approved.sent_at || new Date().toISOString(),
            approved.response?.at || new Date().toISOString(),
            approved.response?.name ?? null,
            approved.response?.by_staff === true,
          ],
        );
      }
    }
    return id;
  });

  const facts = reorderFacts(srcFacts as Record<string, unknown>, {
    srcQuoteNo: src.quote_no,
    foamQty: newFoam,
    artworkChanged: args.input.artworkChanged,
  });
  await saveFacts(newNo, facts);

  if (args.input.boxes.some((b) => b.qty > 0)) {
    const printArg = facts.print_mode === "per_box" ? "per_box" : parsePrintSpec(facts.print_spec);
    await repriceQuoteBoxes(newId, args.tenantId, printArg).catch((e) => console.error("[reorder] box reprice failed", { newNo, err: String(e) }));
  }

  if (args.by === "buyer") {
    await addAdminAlert({
      tenantId: args.tenantId,
      quoteNo: newNo,
      kind: "reorder",
      title: `Reorder of ${src.quote_no}`,
      detail: [
        newFoam != null ? `${newFoam.toLocaleString("en-US")} foam sets` : null,
        args.input.boxes.filter((b) => b.qty > 0).length ? `${args.input.boxes.filter((b) => b.qty > 0).length} box line(s)` : null,
        args.input.artworkChanged ? "artwork changed: needs a new proof" : null,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }
  return { ok: true, quote_no: newNo, quote_id: newId };
}
