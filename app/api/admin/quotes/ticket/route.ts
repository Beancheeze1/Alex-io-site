// app/api/admin/quotes/ticket/route.ts
//
// Step 33: the job ticket for a released quote (app/lib/job-ticket.ts).
//   GET ?quote_no=Q-...            -> { ok, ticket, time_zone }
//   GET ?quote_no=Q-...&format=pdf -> the ticket PDF, with a flat blank page
//                                     per custom RSC / HSC / FOL box line
// Staff (admin / cs / sales) of the shop. 409 NOT_RELEASED until the quote
// is released for manufacture. No prices on the ticket.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { boxDieline, buildJobTicket } from "@/app/lib/job-ticket";
import { jobTicketPdf } from "@/lib/pdf/job-ticket";
import type { Dieline } from "@/lib/box-dieline";

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
    const tenantId = Number(user.tenant_id);
    const quoteNo = String(req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);

    const r = await buildJobTicket(quoteNo, tenantId);
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);

    if (req.nextUrl.searchParams.get("format") !== "pdf") {
      return json({ ok: true, ticket: r.ticket, time_zone: r.timeZone });
    }

    const dielines: { line: number; dieline: Dieline }[] = [];
    for (const b of r.ticket.boxes) {
      if (!b.dxf) continue;
      const d = await boxDieline(quoteNo, tenantId, b.id).catch(() => null);
      if (d && d.ok) dielines.push({ line: d.line, dieline: d.dieline });
    }
    const bytes = await jobTicketPdf(r.ticket, { timeZone: r.timeZone, dielines });
    const name = `${r.ticket.quote_no.replace(/[^a-zA-Z0-9._-]+/g, "-")}__Job-Ticket${r.ticket.revision ? `__${r.ticket.revision}` : ""}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[admin/quotes/ticket] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't make the job ticket." }, 500);
  }
}
