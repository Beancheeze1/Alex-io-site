// app/api/admin/quotes/dieline/route.ts
//
// Step 39C: price a box on a boxes-only quote from a corrugated die line
// file (DXF). Staff only (admin / cs / sales of the quote's shop, or the
// platform owner). Released (locked) quotes are refused.
//
//   GET  ?quote_no=…
//     -> { ok, boxes_only, locked, rows: [{ id, description, style, qty, dieline }] }
//   POST multipart/form-data
//     quote_no, box_id, mode = "preview" | "apply",
//     file (.dxf)  OR  attachment_id (the die line already saved on the quote),
//     roles (JSON: { groupKey: "cut" | "crease" | "perf" | "ignore" }),
//     units ("auto" | "in" | "mm")
//     preview -> { ok, analysis, price: { unit, extended, tooling, method, qty, description } | null,
//                  pieces: [...] when split=1 }
//     apply   -> the box becomes style "dieline" (blank + rule from the file),
//                the file is kept on the quote (quote_attachments, kind
//                'dieline'), and the box is repriced at today's rates with
//                the quote's print, grade, run method and quantity.
//     add     -> Step 39D: a NEW part line from the file (box_id not needed):
//                label (optional name), per_display (default 1), split=1 to
//                add one line per separate part in the file. On a display
//                quote each part's qty = displays x per_display and the
//                assembly line is repriced; otherwise qty = the quote's qty.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import {
  customSelectionInsert,
  displayContext,
  quoteRunMethod,
  repriceQuoteBoxes,
  resolveCustomSelection,
  rowPrintSpec,
} from "@/app/lib/packaging-selection";
import {
  analyzeDieline,
  DIELINE_ROLES,
  parseDielineBlank,
  splitDieline,
  type DielineBlank,
  type DielineRole,
  type DielineUnits,
} from "@/lib/dieline-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };
type BoxRow = {
  id: number;
  kind: string;
  qty: number | string;
  custom_style: string | null;
  board_grade_id: string | number | null;
  print_colors: unknown;
  print_sides: number | string | null;
  description: string | null;
  dieline: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function staffQuote(req: NextRequest, quoteNoRaw: unknown): Promise<{ quote: QuoteRow } | { res: NextResponse }> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: json({ ok: false, error: "unauthorized" }, 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: json({ ok: false, error: "forbidden" }, 403) };
  const quoteNo = typeof quoteNoRaw === "string" ? quoteNoRaw.trim().slice(0, 40) : "";
  if (!quoteNo) return { res: json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400) };
  const quote = await one<QuoteRow>(
    `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
    return { res: json({ ok: false, error: "not_found", message: "Quote not found." }, 404) };
  }
  return { quote };
}

async function loadRows(quoteId: number): Promise<BoxRow[]> {
  // to_jsonb(...) -> 'dieline' reads the column added by migration 049 without
  // failing on a database that doesn't have it yet.
  return q<BoxRow>(
    `SELECT qbs.id, qbs.kind, qbs.qty, qbs.custom_style, qbs.board_grade_id,
            qbs.print_colors, qbs.print_sides, qbs.description,
            to_jsonb(qbs) -> 'dieline' AS dieline
       FROM public.quote_box_selections qbs
      WHERE qbs.quote_id = $1
      ORDER BY qbs.id`,
    [quoteId],
  );
}

function cleanRoles(raw: unknown): Record<string, DielineRole> {
  let o: unknown = raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      o = null;
    }
  }
  const out: Record<string, DielineRole> = {};
  if (!o || typeof o !== "object") return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>).slice(0, 200)) {
    if (typeof v === "string" && (DIELINE_ROLES as readonly string[]).includes(v) && k.length <= 300) out[k] = v as DielineRole;
  }
  return out;
}

function cleanUnits(raw: unknown): DielineUnits {
  return raw === "in" || raw === "mm" ? raw : "auto";
}

export async function GET(req: NextRequest) {
  try {
    const r = await staffQuote(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in r) return r.res;
    const { quote } = r;
    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const rows = await loadRows(quote.id);
    const boxesOnly = facts.pack_type === "boxes_only" && rows.length > 0;
    return json({
      ok: true,
      boxes_only: boxesOnly,
      locked: !!quote.locked,
      rows: boxesOnly
        ? rows.map((x) => ({
            id: Number(x.id),
            description: x.description,
            style: x.custom_style,
            qty: Number(x.qty) || 0,
            dieline: parseDielineBlank(x.dieline),
          }))
        : [],
    });
  } catch (e) {
    console.error("[admin/quotes/dieline] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the boxes." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "invalid_body", message: "Send the die line as a form upload." }, 400);
    const r = await staffQuote(req, form.get("quote_no"));
    if ("res" in r) return r.res;
    const { quote } = r;

    const rawMode = String(form.get("mode") || "");
    const mode = rawMode === "apply" ? "apply" : rawMode === "add" ? "add" : "preview";
    if (mode !== "preview" && quote.locked) {
      return json(
        { ok: false, error: "quote_locked", message: "This quote is released. Revise it before changing the boxes." },
        409,
      );
    }

    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const rows = await loadRows(quote.id);
    if (!(facts.pack_type === "boxes_only" && rows.length > 0)) {
      return json({ ok: false, error: "not_boxes_only", message: "Die lines can be priced on boxes-only quotes." }, 400);
    }
    // "add" makes a new line; preview / apply work on an existing box line.
    const row = rows.find((x) => Number(x.id) === Number(form.get("box_id"))) ?? (mode !== "apply" ? rows[0] : undefined);
    if (!row) return json({ ok: false, error: "box_not_found", message: "That box isn't on this quote." }, 404);
    const split = form.get("split") === "1";
    // Step 39D: re-reading / replacing a part's file keeps its name and count unless new ones are sent.
    const prev = mode !== "add" ? parseDielineBlank(row.dieline) : null;
    const label = String(form.get("label") || "").trim().slice(0, 60) || prev?.label || null;
    const pd = Number(form.get("per_display"));
    const perDisplay = form.get("per_display") != null && Number.isInteger(pd) && pd >= 1 && pd <= 10000 ? pd : prev?.per_display ?? 1;

    // ---- The file: a new upload, or the die line already saved on this quote ----
    let text: string;
    let filename: string;
    let bytes: Buffer | null = null;
    let attachmentId: number | null = null;
    const file = form.get("file");
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const f = file as File;
      filename = String(f.name || "dieline.dxf").slice(0, 200);
      if (!/\.dxf$/i.test(filename)) {
        return json({ ok: false, error: "not_dxf", message: "Upload a .dxf file (PDF die lines come in a later step)." }, 400);
      }
      if (f.size > MAX_BYTES) return json({ ok: false, error: "too_big", message: "That file is over 5 MB." }, 400);
      bytes = Buffer.from(await f.arrayBuffer());
      text = bytes.toString("utf8");
    } else {
      const aid = Number(form.get("attachment_id"));
      if (!Number.isInteger(aid) || aid <= 0) {
        return json({ ok: false, error: "missing_file", message: "Choose a die line file." }, 400);
      }
      const att = await one<{ id: number; filename: string; data: Buffer }>(
        `SELECT id, filename, data FROM public.quote_attachments WHERE id = $1 AND quote_id = $2 LIMIT 1`,
        [aid, quote.id],
      );
      if (!att) return json({ ok: false, error: "attachment_not_found", message: "That file isn't on this quote." }, 404);
      attachmentId = Number(att.id);
      filename = String(att.filename || "dieline.dxf");
      text = Buffer.from(att.data).toString("utf8");
    }

    const roles = cleanRoles(form.get("roles"));
    const units = cleanUnits(form.get("units"));
    const analysis = analyzeDieline(text, { roles, units, split }); // Step 39D2: split-aware hint
    if (!analysis.ok) return json({ ok: false, error: analysis.error, message: analysis.message }, 422);

    const m = analysis.measure;
    // Only the roles staff changed are kept (the rest re-detect the same way).
    const keptRoles: Record<string, DielineRole> = {};
    for (const g of analysis.groups) if (g.role !== g.auto_role) keptRoles[g.key] = g.role;
    const blank: DielineBlank = {
      length_in: m.length_in,
      width_in: m.width_in,
      cut_in: m.cut_in,
      crease_in: m.crease_in,
      perf_in: m.perf_in,
      rule_in: m.rule_in,
      filename,
      attachment_id: attachmentId,
      roles: keptRoles,
      units: analysis.units,
      per_display: perDisplay,
      label,
    };
    // Step 39D: one line per separate part in the file (asked for with split=1).
    const sp = split ? splitDieline(text, { roles, units }) : null;
    if (split && sp && !sp.ok) return json({ ok: false, error: sp.error, message: sp.message }, 422);

    const perBox = facts.print_mode === "per_box";
    const print = perBox ? rowPrintSpec(row.print_colors, row.print_sides) : parsePrintSpec(facts.print_spec);
    const qty = Math.max(1, Math.round(Number(row.qty) || 1));
    const gradeId = row.board_grade_id == null ? null : Number(row.board_grade_id);

    if (mode === "preview") {
      const priced = await resolveCustomSelection(m.length_in, m.width_in, 0, "dieline", qty, Number(quote.tenant_id), {
        gradeId,
        print,
        method: await quoteRunMethod(quote.quote_no),
        dieline: blank,
      });
      return json({
        ok: true,
        analysis,
        pieces: sp && sp.ok ? sp.pieces : null,
        stray_in: sp && sp.ok ? sp.stray_in : null,
        price: {
          qty,
          unit: priced.unit_price_usd,
          extended: priced.extended_price_usd,
          tooling: priced.tooling_usd,
          plates: priced.plates_usd,
          method: (priced.pricing_detail as { run_method?: string } | null)?.run_method ?? null,
          description: priced.description,
          note: priced.pricing_note,
        },
      });
    }

    // ---- Keep a newly uploaded file on the quote (add and apply) ----
    if (bytes) {
      const att = await one<{ id: number }>(
        `INSERT INTO public.quote_attachments (quote_id, quote_no, filename, content_type, size_bytes, data, kind)
         VALUES ($1, $2, $3, $4, $5, $6, 'dieline')
         RETURNING id`,
        [quote.id, quote.quote_no, filename, "application/dxf", bytes.length, bytes],
      );
      if (!att) return json({ ok: false, error: "insert_failed", message: "Couldn't save the file." }, 500);
      blank.attachment_id = Number(att.id);
    }

    // ---- Step 39D, add: new part line(s) from the file ----
    if (mode === "add") {
      const disp = await displayContext(quote.id);
      const displays = disp.isDisplay ? disp.displays ?? 1 : null;
      const baseQty = Math.max(1, Math.round(Number(facts.qty) || Number(rows[0]?.qty) || 1));
      const lineQty = displays ? displays * perDisplay : baseQty;
      const runMethod = await quoteRunMethod(quote.quote_no);
      const addPrint = perBox ? null : parsePrintSpec(facts.print_spec);
      const parts: DielineBlank[] =
        sp && sp.ok
          ? sp.pieces.map((pc) => ({
              ...blank,
              length_in: pc.length_in,
              width_in: pc.width_in,
              cut_in: pc.cut_in,
              crease_in: pc.crease_in,
              perf_in: pc.perf_in,
              rule_in: pc.rule_in,
              piece: pc.piece,
              label: label ? `${label} ${pc.piece}` : `Part ${pc.piece}`,
            }))
          : [blank];
      const ids: number[] = [];
      for (const part of parts) {
        const resolved = await resolveCustomSelection(part.length_in, part.width_in, 0, "dieline", lineQty, Number(quote.tenant_id), {
          gradeId,
          print: addPrint,
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
        const saved = await one<{ id: number }>(ins.text, ins.values);
        if (saved) ids.push(Number(saved.id));
      }
      // The assembly line follows the parts count.
      if (disp.isDisplay) await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), perBox ? "per_box" : addPrint);
      return json({ ok: true, quote_no: quote.quote_no, added: ids });
    }

    // ---- Apply: make the box a die line, reprice ----
    await q(
      `UPDATE public.quote_box_selections
          SET kind = 'custom', box_id = NULL, sku = NULL,
              custom_length_in = $2, custom_width_in = $3, custom_height_in = 0, custom_style = 'dieline',
              custom_cells_across = NULL, custom_cells_down = NULL,
              dieline = $4::jsonb
        WHERE id = $1`,
      [row.id, m.length_in, m.width_in, JSON.stringify(blank)],
    );

    if (!perBox) {
      await saveFacts(quote.quote_no, {
        ...facts,
        customer_box_in: { L: m.length_in, W: m.width_in, H: 0, style: "dieline" },
      });
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), print);
    } else {
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), "per_box", { onlyRowId: Number(row.id) });
    }

    return json({ ok: true, quote_no: quote.quote_no, box_id: Number(row.id), dieline: blank });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42703") {
      return json({ ok: false, error: "not_migrated", message: "Die lines aren't set up yet (migration 049)." }, 503);
    }
    console.error("[admin/quotes/dieline] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't read the die line. Please try again." }, 500);
  }
}
