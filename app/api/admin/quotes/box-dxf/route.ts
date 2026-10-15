// app/api/admin/quotes/box-dxf/route.ts
//
// Step 33: flat blank DXF for one custom RSC / HSC / FOL box line
// (lib/box-dieline.ts), with the shop's current corrugated settings.
//   GET ?quote_no=Q-...&line_id=<quote_box_selections.id>
//     -> the .dxf (CUT and CREASE layers, inches)
//   GET ...&format=json -> { ok, dieline, line, priced_blank_differs }
// Staff (admin / cs / sales) of the shop. Any time (samples are often cut
// before release); the job ticket links to it after release.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { boxDieline } from "@/app/lib/job-ticket";
import { dielineDxf, dielineFilename } from "@/lib/box-dieline";
import { dimsText } from "@/app/lib/job-ticket-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return json({ ok: false, error: "forbidden", message: "Staff only." }, 403);
    const sp = req.nextUrl.searchParams;
    const quoteNo = String(sp.get("quote_no") || "").trim().slice(0, 40);
    const lineId = Number(sp.get("line_id"));
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);
    if (!Number.isInteger(lineId) || lineId <= 0) return json({ ok: false, error: "missing_line_id", message: "line_id is required." }, 400);

    const r = await boxDieline(quoteNo, Number(user.tenant_id), lineId);
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);

    if (sp.get("format") === "json") {
      return json({ ok: true, line: r.line, dieline: r.dieline, priced_blank_differs: r.priced_blank_differs });
    }

    const notes = [
      `${quoteNo} line ${r.line}: qty ${r.box.qty}${r.box.grade ? `, ${r.box.grade}` : ""}${r.box.print ? `, ${r.box.print}` : ""}`,
      ...(r.priced_blank_differs && r.box.blank
        ? [`NOTE: priced on a ${dimsText({ L: r.box.blank.length_in, W: r.box.blank.width_in })} blank; corrugated settings changed since.`]
        : []),
    ];
    const body = dielineDxf(r.dieline, notes);
    const name = dielineFilename(quoteNo, r.line, r.dieline);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/dxf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[admin/quotes/box-dxf] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't make the DXF." }, 500);
  }
}
