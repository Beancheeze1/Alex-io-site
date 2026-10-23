// app/api/admin/quotes/foam-sheet-dxf/route.ts
//
// Step 39M: the DXF for one foam sheet cut file on the job ticket
// (app/lib/job-ticket.ts foamSheetDxf): the outline plus only the cavities
// cut through that sheet, so each file matches one steel-rule die / CNC program.
//   GET ?quote_no=Q-...&file=<1-based sheet file> -> the .dxf (inches)
// Staff (admin / cs / sales) of the shop, like the box blank DXF.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { foamSheetDxf } from "@/app/lib/job-ticket";

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
    const file = Number(sp.get("file"));
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);
    if (!Number.isInteger(file) || file <= 0) return json({ ok: false, error: "missing_file", message: "file is required." }, 400);

    const r = await foamSheetDxf(quoteNo, Number(user.tenant_id), file);
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);
    return new NextResponse(r.dxf, {
      status: 200,
      headers: {
        "Content-Type": "application/dxf",
        "Content-Disposition": `attachment; filename="${r.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[admin/quotes/foam-sheet-dxf] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't make the DXF." }, 500);
  }
}
