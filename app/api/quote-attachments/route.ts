// app/api/quote-attachments/route.ts
//
// Read-only attachment listing for a quote, for the admin quote page's
// Attachments panel. Returns metadata only (no bytes) — use
// GET /api/quote-attachments/{id} to fetch/download an individual file.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req as any);

    const enforced = await enforceTenantMatch(req as any, user);
    if (!enforced.ok) {
      return NextResponse.json(enforced.body, { status: enforced.status });
    }

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", message: "Login required." },
        { status: 401 },
      );
    }

    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) {
      return NextResponse.json(
        { ok: false, error: "forbidden", message: "Not allowed." },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const quoteNo = (searchParams.get("quote_no") || "").trim();

    if (!quoteNo) {
      return NextResponse.json(
        { ok: false, error: "missing_quote_no", message: "quote_no is required." },
        { status: 400 },
      );
    }

    // quote_attachments has no tenant_id of its own, so scope through quotes.
    const rows = (await q<Row>(
      `
      SELECT qa.id, qa.filename, qa.content_type, qa.size_bytes
      FROM public.quote_attachments AS qa
      JOIN public."quotes" AS quo
        ON quo.id = qa.quote_id
      WHERE qa.quote_no = $1
        AND quo.tenant_id = $2
      ORDER BY qa.created_at DESC, qa.id DESC
      `,
      [quoteNo, user.tenant_id],
    )) as Row[];

    return NextResponse.json({ ok: true, attachments: rows || [] });
  } catch (err: any) {
    console.error("Error in /api/quote-attachments:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          typeof err?.message === "string"
            ? err.message
            : "Unexpected error loading attachments for this quote.",
      },
      { status: 500 },
    );
  }
}
