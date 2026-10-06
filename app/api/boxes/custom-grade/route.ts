// app/api/boxes/custom-grade/route.ts
//
// Staff tool for the admin quote page: change the board grade on a quote's
// custom RSC box and reprice it (Corrugated Step 3A).
//   GET  ?quote_no=…              -> { ok, grades: [{id,name,flute}], selection }
//   POST { quote_no, grade_id }   -> { ok, selection }  (repriced)
// Roles: admin, cs, sales of the quote's own tenant (or the platform owner).
// Grades and pricing always come from the QUOTE's tenant.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import {
  customSelectionUpdate,
  printSpecForQuote,
  resolveCustomSelection,
} from "@/app/lib/packaging-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type QuoteRow = { id: number; quote_no: string; tenant_id: number };

async function staffQuote(req: NextRequest, quoteNo: string): Promise<QuoteRow | NextResponse> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) {
    return json({ ok: false, error: "forbidden", message: "Not allowed." }, 403);
  }
  if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);

  const quote = await one<QuoteRow>(
    `SELECT id, quote_no, tenant_id FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
    return json({ ok: false, error: "not_found", message: "Quote not found." }, 404);
  }
  return quote;
}

async function activeGrades(tenantId: number) {
  try {
    const rows = await q<{ id: string | number; name: string; flute: string }>(
      `SELECT id, name, flute FROM public.corrugated_board_grades
        WHERE tenant_id = $1 AND active = true
        ORDER BY sort_order, id`,
      [tenantId],
    );
    return rows.map((r) => ({ id: Number(r.id), name: String(r.name), flute: String(r.flute) }));
  } catch (e: any) {
    if (e?.code === "42P01") return [];
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim();
  const quote = await staffQuote(req, quoteNo);
  if (quote instanceof NextResponse) return quote;

  try {
    const grades = await activeGrades(Number(quote.tenant_id));
    const selection = await one<{ id: number; board_grade_id: string | number | null; board_grade_name: string | null }>(
      `SELECT id, board_grade_id, board_grade_name FROM public.quote_box_selections
        WHERE quote_id = $1 AND kind = 'custom' LIMIT 1`,
      [quote.id],
    );
    return json({
      ok: true,
      grades,
      selection: selection
        ? {
            id: Number(selection.id),
            board_grade_id: selection.board_grade_id == null ? null : Number(selection.board_grade_id),
            board_grade_name: selection.board_grade_name,
          }
        : null,
    });
  } catch (e) {
    console.error("[boxes/custom-grade] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Could not load board grades." }, 500);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { quote_no?: unknown; grade_id?: unknown } | null;
  const quoteNo = typeof body?.quote_no === "string" ? body.quote_no.trim() : "";
  const quote = await staffQuote(req, quoteNo);
  if (quote instanceof NextResponse) return quote;

  const gradeId = Number(body?.grade_id);
  if (!Number.isInteger(gradeId) || gradeId <= 0) {
    return json({ ok: false, error: "invalid_grade", message: "Pick a board grade." }, 400);
  }

  try {
    const grades = await activeGrades(Number(quote.tenant_id));
    if (!grades.some((g) => g.id === gradeId)) {
      return json({ ok: false, error: "grade_not_found", message: "That board grade isn't active for this shop." }, 400);
    }

    const row = await one<{
      id: number;
      custom_length_in: string | number;
      custom_width_in: string | number;
      custom_height_in: string | number;
      custom_style: string;
      qty: number;
    }>(
      `SELECT id, custom_length_in, custom_width_in, custom_height_in, custom_style, qty
         FROM public.quote_box_selections
        WHERE quote_id = $1 AND kind = 'custom'
        LIMIT 1`,
      [quote.id],
    );
    if (!row || String(row.custom_style || "").toLowerCase() !== "rsc") {
      return json({ ok: false, error: "no_custom_rsc", message: "This quote has no custom RSC box." }, 400);
    }

    const resolved = await resolveCustomSelection(
      Number(row.custom_length_in),
      Number(row.custom_width_in),
      Number(row.custom_height_in),
      row.custom_style,
      Number(row.qty) || 1,
      Number(quote.tenant_id),
      { gradeId, print: await printSpecForQuote(quote.quote_no) },
    );
    const upd = customSelectionUpdate(row.id, resolved);
    const saved = await q(upd.text, upd.values);
    return json({ ok: true, selection: saved[0] ?? null });
  } catch (e) {
    console.error("[boxes/custom-grade] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Could not change the board grade." }, 500);
  }
}
