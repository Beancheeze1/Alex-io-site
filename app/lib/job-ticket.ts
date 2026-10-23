// app/lib/job-ticket.ts
//
// Step 33: builds the job ticket (app/lib/job-ticket-core.ts) for a released
// quote from what the release froze: the quote, its released layout package,
// foam lines, box lines, approval, ship-to, kept freight and proofs. No prices.
// Also: the flat blank die line for a custom RSC / HSC / FOL box line
// (lib/box-dieline.ts) with the shop's current corrugated settings.
// Step 39M: the foam's sheet build (how each piece is laminated from the
// shop's stock sheets, withSheets) and one DXF per different sheet
// (foamSheetDxf), using the stock sizes the quote was priced with.

import { one, q } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { foamGeometry, withSheets } from "@/app/lib/pricing/foam-geometry";
import { foamStockList, LAM_RULE_SHEETS, pickFoamProcess } from "@/app/lib/pricing/foam-process";
import { lockedChargeSettings } from "@/app/lib/pricing/foam-lock";
import { buildDxfForLayer } from "@/app/lib/layout/layer-dxf";
import { loadApprovalRow, quoteTerms } from "@/app/lib/quote-approval";
import { computeApproval } from "@/app/lib/quote-approval-core";
import { effectiveTerms, loadShipTo, shopFreightSettings } from "@/app/lib/freight";
import { proofSummary } from "@/app/lib/proofs";
import { shopSender } from "@/app/lib/quote-mail";
import { buildFullPackageFilename, buildLayerFilename } from "@/app/lib/cad-download";
import { boxStyleLabel, parseBoxStyle } from "@/lib/box-styles";
import { describePrintSpec, parsePrintSpec } from "@/lib/corrugated-price";
import { loadCorrugated } from "@/lib/corrugated";
import { isSlottedStyle, slottedDieline, type Dieline } from "@/lib/box-dieline";
import {
  TERMS_SHORT,
  addressLines,
  foamBuildForTicket,
  runText,
  sheetLayout,
  type JobTicket,
  type TicketBox,
  type TicketFoam,
} from "@/app/lib/job-ticket-core";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  created_at: unknown;
  locked: boolean | null;
  locked_at: unknown;
  po_number: string | null;
  is_rush: boolean | null;
  released_by: string | null;
};

type ItemRow = {
  id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_name: string | null;
  notes: string | null;
};

type BoxRow = {
  id: number;
  kind: "stock" | "custom";
  qty: number;
  sku: string | null;
  description: string | null;
  custom_style: string | null;
  stock_style: string | null;
  vendor: string | null;
  inside_length_in: unknown;
  inside_width_in: unknown;
  inside_height_in: unknown;
  board_grade_name: string | null;
  flute: string | null;
  print_colors: unknown;
  print_sides: unknown;
  detail: Record<string, unknown> | null;
  cells_across: number | null;
  cells_down: number | null;
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null || v === "" ? null : String(v));
const pos = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isLayerRow = (it: ItemRow) => String(it.notes || "").toUpperCase().includes("[LAYOUT-LAYER]");
const isPackagingRow = (it: ItemRow) => /Requested shipping carton|\[PACKAGING\]/.test(String(it.notes || ""));

export type TicketResult = { ok: true; ticket: JobTicket; quoteId: number; timeZone: string } | { ok: false; status: number; error: string; message: string };

async function loadQuote(quoteNo: string, tenantId: number): Promise<QuoteRow | null> {
  return one<QuoteRow>(
    `SELECT qq.id, qq.quote_no, qq.customer_name, qq.company, qq.email, qq.phone, qq.created_at,
            qq.locked, qq.locked_at, qq.po_number, qq.is_rush,
            COALESCE(u.name, u.email) AS released_by
       FROM public.quotes qq
       LEFT JOIN public."users" u ON u.id = qq.updated_by_user_id
      WHERE qq.quote_no = $1 AND qq.tenant_id = $2
      LIMIT 1`,
    [quoteNo, tenantId],
  );
}

async function loadBoxRows(quoteId: number): Promise<BoxRow[]> {
  return q<BoxRow>(
    `SELECT qbs.id, qbs.kind, qbs.qty, qbs.sku, COALESCE(qbs.description, b.description) AS description,
            qbs.custom_style, b.style AS stock_style, b.vendor,
            COALESCE(b.inside_length_in, qbs.custom_length_in) AS inside_length_in,
            COALESCE(b.inside_width_in, qbs.custom_width_in) AS inside_width_in,
            COALESCE(b.inside_height_in, qbs.custom_height_in) AS inside_height_in,
            qbs.board_grade_name, g.flute,
            qbs.print_colors, qbs.print_sides,
            to_jsonb(qbs) -> 'pricing_detail' AS detail,
            (to_jsonb(qbs) ->> 'custom_cells_across')::int AS cells_across,
            (to_jsonb(qbs) ->> 'custom_cells_down')::int AS cells_down
       FROM public.quote_box_selections qbs
       LEFT JOIN public.boxes b ON b.id = qbs.box_id
       LEFT JOIN public.corrugated_board_grades g ON g.id = qbs.board_grade_id
      WHERE qbs.quote_id = $1
      ORDER BY qbs.id ASC`,
    [quoteId],
  );
}

function boxFromRow(r: BoxRow, line: number): TicketBox {
  const detail = (r.detail && typeof r.detail === "object" ? r.detail : {}) as Record<string, unknown>;
  // Step 39D: the assembly / packing line of a display, and die line parts (flat blank, no depth).
  const isAssembly = r.custom_style === "assembly";
  const isPart = r.custom_style === "dieline";
  const style = isAssembly
    ? "assembly"
    : r.kind === "custom"
      ? parseBoxStyle(r.custom_style) ?? "rsc"
      : String(r.stock_style || "").toLowerCase() || "stock";
  const L = pos(r.inside_length_in);
  const W = pos(r.inside_width_in);
  const D = Number(r.inside_height_in);
  const inside = !isAssembly && !isPart && L && W && Number.isFinite(D) && D >= 0 ? { L, W, D } : null;
  let colors: unknown = r.print_colors;
  if (typeof colors === "string") {
    try {
      colors = JSON.parse(colors);
    } catch {
      colors = null;
    }
  }
  const spec = parsePrintSpec({ colors, sides: r.print_sides });
  const method = detail.run_method ?? null;
  const blank = detail.blank && typeof detail.blank === "object" ? (detail.blank as Record<string, unknown>) : null;
  const sheet = detail.sheet && typeof detail.sheet === "object" ? (detail.sheet as Record<string, unknown>) : null;
  return {
    line,
    id: Number(r.id),
    kind: r.kind,
    qty: Number(r.qty) || 0,
    style,
    style_label: isAssembly
      ? "Assembly and packing (qty = displays)"
      : isPart
        ? String(r.description || "Die-cut part from file").split(" · ")[0]
        : r.kind === "custom"
          ? boxStyleLabel(style)
          : r.stock_style
            ? `Stock ${String(r.stock_style).toUpperCase()}`
            : "Stock box",
    sku: r.sku,
    vendor: r.vendor,
    description: r.description,
    inside,
    grade: r.board_grade_name,
    flute: r.flute,
    cells: r.cells_across && r.cells_down ? { across: Number(r.cells_across), down: Number(r.cells_down) } : null,
    print: isAssembly ? "—" : describePrintSpec(spec, method === "digital" ? "digital" : method === "plates" ? "plates" : null),
    run: r.kind === "custom" && !isAssembly ? runText(method) : null,
    blank: blank && pos(blank.length_in) && pos(blank.width_in) ? { length_in: Number(blank.length_in), width_in: Number(blank.width_in) } : null,
    sheet:
      sheet && pos(sheet.length_in) && pos(sheet.width_in)
        ? { length_in: Number(sheet.length_in), width_in: Number(sheet.width_in), up: Number(sheet.up) || 1 }
        : null,
    dxf: r.kind === "custom" && isSlottedStyle(style) && !!inside && inside.D > 0,
  };
}

/**
 * Step 39M: the stock sheet sizes for the build: the ones the quote was priced
 * with (its charge lock), else (a quote priced before Step 39L) today's.
 */
async function buildStock(quoteNo: string, tenantId: number): Promise<{ stock: number[]; note: string | null }> {
  const live = await getPricingSettings(tenantId).catch(() => null);
  const today = pickFoamProcess(live);
  const charges = await lockedChargeSettings(quoteNo, live, false).catch(() => null);
  const fp = charges?.foam_process ?? null;
  if (fp && fp.lam_rule >= LAM_RULE_SHEETS) return { stock: foamStockList(fp), note: null };
  return {
    stock: foamStockList(today),
    note: "This quote was priced before sheet-by-sheet lamination; the build below uses today's stock sheet sizes.",
  };
}

async function foamSection(quoteId: number, quoteNo: string, revision: string | null, tenantId: number): Promise<TicketFoam | null> {
  const items = await q<ItemRow>(
    `SELECT qi.id, qi.length_in, qi.width_in, qi.height_in, qi.qty, m.name AS material_name, qi.notes
       FROM public.quote_items qi
       LEFT JOIN public.materials m ON m.id = qi.material_id
      WHERE qi.quote_id = $1
      ORDER BY qi.id ASC`,
    [quoteId],
  );
  const primary = items.find((it) => !isLayerRow(it) && !isPackagingRow(it));
  if (!primary) return null;
  const layerRows = items.filter(isLayerRow);
  const pkg = await one<{ id: number; layout_json: unknown }>(
    `SELECT id, layout_json FROM public.quote_layout_packages
      WHERE quote_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [quoteId],
  );
  const block = { L: Number(primary.length_in) || 0, W: Number(primary.width_in) || 0, H: Number(primary.height_in) || 0 };
  const geom = foamGeometry(pkg?.layout_json ?? null, block);
  const lay = (pkg?.layout_json && typeof pkg.layout_json === "object" ? pkg.layout_json : {}) as Record<string, unknown>;
  const stack = Array.isArray(lay.stack) ? (lay.stack as Record<string, unknown>[]) : [];
  const layers = geom.layers.map((g, i) => {
    const raw = stack[i] || {};
    const label = [raw.label, raw.name, raw.title].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const material = layerRows.length === geom.layers.length ? layerRows[i]?.material_name ?? primary.material_name : primary.material_name;
    return {
      n: i + 1,
      label: label ? label.trim() : null,
      thickness_in: g.thickness_in,
      material: material ?? null,
      cavities: g.cavity_count,
      loose: g.loose,
      cut_file: buildLayerFilename({
        quoteNo,
        layerIndex: i,
        layerLabel: label ?? null,
        thicknessIn: g.thickness_in,
        ext: "dxf",
        revision,
      }).replace(/\.dxf$/, ""),
    };
  });
  return {
    sets: Number(primary.qty) || 0,
    material: primary.material_name,
    block: { L: geom.length_in, W: geom.width_in, H: geom.height_in },
    layers,
    package_file: buildFullPackageFilename({ quoteNo, ext: "dxf", revision }).replace(/\.dxf$/, ""),
    release_pkg_id: pkg ? Number(pkg.id) : null,
    build: await (async () => {
      const { stock, note } = await buildStock(quoteNo, tenantId);
      return foamBuildForTicket({
        geom: withSheets(geom, stock),
        labels: layers.map((l) => l.label),
        quoteNo,
        revision,
        note,
      });
    })().catch(() => null),
  };
}

/** The job ticket for a released quote of the shop. */
export async function buildJobTicket(quoteNo: string, tenantId: number): Promise<TicketResult> {
  const quote = await loadQuote(quoteNo, tenantId);
  if (!quote) return { ok: false, status: 404, error: "not_found", message: "Quote not found." };
  if (!quote.locked) {
    return { ok: false, status: 409, error: "NOT_RELEASED", message: "The job ticket is made when the quote is released for manufacture." };
  }

  const facts = ((await loadFacts(quote.quote_no).catch(() => null)) || {}) as Record<string, unknown>;
  const revision = String(facts.released_rev || facts.revision || "").replace(/^rev\s*/i, "").trim() || null;

  const [sender, settings, approvalRow, terms, shipTo, freightSettings, proofs, boxRows, foam, lockRow] = await Promise.all([
    shopSender(tenantId).catch(() => null),
    getPricingSettings(tenantId).catch(() => null),
    loadApprovalRow(quote.id),
    quoteTerms(tenantId),
    loadShipTo(quote.id),
    shopFreightSettings(tenantId),
    proofSummary({ id: quote.id, quote_no: quote.quote_no }).catch(() => null),
    loadBoxRows(quote.id),
    foamSection(quote.id, quote.quote_no, revision, tenantId),
    one<{ l: Record<string, unknown> | null }>(`SELECT to_jsonb(q) -> 'freight_lock' AS l FROM public.quotes q WHERE q.id = $1`, [quote.id]).catch(
      () => null,
    ),
  ]);

  const approval = computeApproval(approvalRow, 0, terms);
  const t = effectiveTerms(shipTo, freightSettings);
  const kept = (lockRow?.l && typeof lockRow.l === "object" ? (lockRow.l.result as Record<string, unknown> | undefined) : undefined) || null;
  const approved = proofs ? [...proofs.versions].filter((v) => v.status === "approved").sort((a, b) => b.version - a.version)[0] : undefined;
  // Step 37I: box quotes keep the buyer's notes in facts.customer_notes
  const rawNotes = [facts.notes, facts.customer_notes].find((v) => typeof v === "string" && v.trim());
  const notes = typeof rawNotes === "string" ? rawNotes.trim().slice(0, 2000) : null;
  const timeZone = String((settings as { shop_timezone?: unknown } | null)?.shop_timezone || "") || "America/New_York";

  const ticket: JobTicket = {
    shop: sender?.brand || "Alex-IO",
    quote_no: quote.quote_no,
    revision,
    created_at: iso(quote.created_at),
    released_at: iso(quote.locked_at),
    released_by: quote.released_by,
    customer: {
      name: quote.customer_name && quote.customer_name.trim() !== "Customer" ? quote.customer_name : null,
      company: quote.company,
      email: quote.email,
      phone: quote.phone,
    },
    po: approval.accepted?.po || quote.po_number || null,
    rush: quote.is_rush === true,
    accepted: approval.accepted ? { name: approval.accepted.name, at: approval.accepted.at } : null,
    confirmed: approval.confirmed ? { by: approval.confirmed.by, at: approval.confirmed.at } : null,
    lead_time: approval.lead_time,
    ship: {
      terms: t,
      terms_label: TERMS_SHORT[t],
      name: shipTo.name,
      company: shipTo.company,
      lines: addressLines(shipTo),
      account: shipTo.account,
      mode: kept && (kept.mode === "parcel" || kept.mode === "ltl") ? kept.mode : null,
      cartons: kept && Number(kept.cartons) > 0 ? Number(kept.cartons) : null,
      pallets: kept && Number(kept.pallets) > 0 ? Number(kept.pallets) : null,
      weight_lb: kept && Number(kept.actual_lb) > 0 ? Math.round(Number(kept.actual_lb)) : null,
    },
    foam,
    boxes: await withDieLineBlanks(boxRows.map((r, i) => boxFromRow(r, i + 1)), tenantId),
    proof:
      proofs && (proofs.required || proofs.versions.length > 0)
        ? {
            required: proofs.required,
            version: approved ? approved.version : proofs.latest_version,
            status: proofs.stage,
            approved_by: approved?.response?.name ?? null,
            approved_at: approved?.response?.at ?? null,
          }
        : null,
    customer_notes: notes,
  };
  return { ok: true, ticket, quoteId: quote.id, timeZone };
}

export type DielineResult =
  | { ok: true; dieline: Dieline; line: number; box: TicketBox; priced_blank_differs: boolean }
  | { ok: false; status: number; error: string; message: string };

/**
 * Step 36C: a custom RSC / HSC / FOL line priced without an engine blank (e.g.
 * from the nearest stock box) shows the die line's blank instead of "—".
 */
async function withDieLineBlanks(boxes: TicketBox[], tenantId: number): Promise<TicketBox[]> {
  if (!boxes.some((b) => !b.blank && b.dxf && b.inside && isSlottedStyle(b.style))) return boxes;
  const cfg = await loadCorrugated(tenantId).catch(() => null);
  if (!cfg) return boxes;
  return boxes.map((b) => {
    if (b.blank || !b.dxf || !b.inside || !isSlottedStyle(b.style)) return b;
    const gradeFlute = b.flute || cfg.grades.find((g) => g.is_default)?.flute || null;
    const flute = cfg.flutes.find((f) => f.flute === gradeFlute) || cfg.flutes[0];
    const dl = flute ? slottedDieline(b.style, b.inside, flute, { ...cfg.settings, waste_pct: 0 }) : null;
    return dl ? { ...b, blank: { length_in: dl.blank.length_in, width_in: dl.blank.width_in }, blank_from_die_line: true } : b;
  });
}

/** The flat blank for one box line (selection id) of the shop's quote. */
export async function boxDieline(quoteNo: string, tenantId: number, selectionId: number): Promise<DielineResult> {
  const quote = await loadQuote(quoteNo, tenantId);
  if (!quote) return { ok: false, status: 404, error: "not_found", message: "Quote not found." };
  const rows = await loadBoxRows(quote.id);
  const idx = rows.findIndex((r) => Number(r.id) === selectionId);
  if (idx < 0) return { ok: false, status: 404, error: "line_not_found", message: "That box line isn't on this quote." };
  const box = boxFromRow(rows[idx], idx + 1);
  if (!box.dxf || !box.inside || !isSlottedStyle(box.style)) {
    return { ok: false, status: 422, error: "no_dieline", message: "Flat blank DXFs are made for custom RSC, HSC and FOL boxes." };
  }
  const cfg = await loadCorrugated(tenantId);
  const gradeFlute = box.flute || cfg.grades.find((g) => g.is_default)?.flute || null;
  const flute = cfg.flutes.find((f) => f.flute === gradeFlute) || cfg.flutes[0];
  if (!flute) return { ok: false, status: 422, error: "no_flutes", message: "Set up flutes under Admin -> Corrugated first." };
  const dl = slottedDieline(box.style, box.inside, flute, { ...cfg.settings, waste_pct: 0 });
  if (!dl) return { ok: false, status: 422, error: "bad_size", message: "This box's size can't be laid out as a slotted blank." };
  const differs =
    !!box.blank && (Math.abs(box.blank.length_in - dl.blank.length_in) > 0.001 || Math.abs(box.blank.width_in - dl.blank.width_in) > 0.001);
  return { ok: true, dieline: dl, line: idx + 1, box, priced_blank_differs: differs };
}

export type SheetDxfResult = { ok: true; dxf: string; filename: string } | { ok: false; status: number; error: string; message: string };

/**
 * Step 39M: the DXF for one sheet cut file of the quote's foam (the outline
 * plus only the cavities cut through that sheet), sized like the layer DXFs.
 */
export async function foamSheetDxf(quoteNo: string, tenantId: number, file: number): Promise<SheetDxfResult> {
  const quote = await loadQuote(quoteNo, tenantId);
  if (!quote) return { ok: false, status: 404, error: "not_found", message: "Quote not found." };
  const facts = ((await loadFacts(quote.quote_no).catch(() => null)) || {}) as Record<string, unknown>;
  const revision = String(facts.released_rev || facts.revision || "").replace(/^rev\s*/i, "").trim() || null;
  const foam = await foamSection(quote.id, quote.quote_no, revision, tenantId);
  const f = foam?.build?.files.find((x) => x.file === file);
  if (!foam || !f) return { ok: false, status: 404, error: "no_sheet", message: "That sheet file isn't on this quote." };
  const pkg = await one<{ layout_json: unknown }>(
    `SELECT layout_json FROM public.quote_layout_packages
      WHERE quote_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [quote.id],
  );
  const layout = typeof pkg?.layout_json === "string" ? (JSON.parse(pkg.layout_json) as unknown) : pkg?.layout_json;
  // Sized like the per-layer DXFs (/api/quote/layout/dxf-layer): the first foam line's L x W.
  const primary = await one<{ length_in: string; width_in: string }>(
    `SELECT length_in, width_in FROM public.quote_items WHERE quote_id = $1 ORDER BY id ASC LIMIT 1`,
    [quote.id],
  );
  const L = Number(primary?.length_in);
  const W = Number(primary?.width_in);
  const lay = sheetLayout(layout, f);
  const dxf = lay ? buildDxfForLayer(lay, f.layer_index, L > 0 && W > 0 ? { L, W } : undefined) : null;
  if (!dxf) return { ok: false, status: 422, error: "no_layout", message: "This quote has no foam layout to draw." };
  return { ok: true, dxf, filename: `${f.name}.dxf` };
}
