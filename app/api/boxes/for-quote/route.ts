// app/api/boxes/for-quote/route.ts
//
// Read-only helper for admin views and quote viewer.
//
// Given a quote_no (e.g. ?quote_no=Q-AI-20251206-021028) this returns
// any cartons the customer has "requested" from the public quote viewer.
//
// Shape matches AdminQuoteClient / QuotePrintClient expectations:
//   {
//     ok: true,
//     selections: [
//       {
//         id: number;          // quote_box_selections.id
//         quote_id: number;
//         kind: "stock" | "custom";
//         box_id: number | null;   // null for custom selections
//         sku: string | null;      // null for custom selections
//         vendor: string | null;
//         style: string | null;
//         description: string | null;
//         qty: number;
//         inside_length_in: number;
//         inside_width_in: number;
//         inside_height_in: number;
//         unit_price_usd?: number | null;
//         extended_price_usd?: number | null;
//       },
//       ...
//     ]
//   }
//
// Path A safe:
//   - SELECT-only, no writes.
//   - Does not touch pricing, cavity parsing, or layout logic.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  quote_id: number;
  kind: "stock" | "custom";
  box_id: number | null;
  sku: string | null;
  vendor: string | null;
  style: string | null;
  description: string | null;
  qty: number;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  unit_price_usd?: number | null;
  extended_price_usd?: number | null;
};

type Ok = {
  ok: true;
  selections: Row[];
};

type Err = {
  ok: false;
  error: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const quoteNo = (searchParams.get("quote_no") || "").trim();

    if (!quoteNo) {
      const body: Err = {
        ok: false,
        error: "Missing quote_no query parameter.",
      };
      return NextResponse.json(body, { status: 400 });
    }

    // Public widget flows (customer-facing form/chat) have no session.
    // allowPublic resolves the tenant from the host so unauthenticated
    // customers can load their carton selections in the layout editor.
    const user = await getCurrentUserFromRequest(req as any);
    const enforced = await enforceTenantMatch(req, user, { allowPublic: true });
    if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });

    const tenantId = user?.tenant_id ?? enforced.tenant_id;

    // Read-only join from quotes -> quote_box_selections -> boxes.
    // LEFT JOIN because custom selections (box_id null) have no boxes row to
    // join against; their own custom_* columns and frozen description carry
    // the data instead (same fix as /api/quote/print).
    const rows = (await q<Row>(
      `
      SELECT
        qbs.id,
        qbs.quote_id,
        qbs.kind,
        qbs.box_id,
        qbs.sku,
        b.vendor,
        coalesce(b.style, qbs.custom_style) as style,
        qbs.description,
        qbs.qty,
        coalesce(b.inside_length_in, qbs.custom_length_in) as inside_length_in,
        coalesce(b.inside_width_in, qbs.custom_width_in) as inside_width_in,
        coalesce(b.inside_height_in, qbs.custom_height_in) as inside_height_in,
        qbs.unit_price_usd,
        qbs.extended_price_usd
      FROM public.quote_box_selections AS qbs
      JOIN public."quotes" AS q
        ON q.id = qbs.quote_id
      LEFT JOIN public.boxes AS b
        ON b.id = qbs.box_id
      WHERE q.quote_no = $1
        AND q.tenant_id = $2
      ORDER BY qbs.id ASC
      `,
      [quoteNo, tenantId],
    )) as Row[];

    const body: Ok = {
      ok: true,
      selections: rows || [],
    };

    return NextResponse.json(body);
  } catch (err: any) {
    console.error("Error in /api/boxes/for-quote:", err);
    const body: Err = {
      ok: false,
      error:
        typeof err?.message === "string"
          ? err.message
          : "Unexpected error loading requested cartons for this quote.",
    };
    return NextResponse.json(body, { status: 500 });
  }
}
