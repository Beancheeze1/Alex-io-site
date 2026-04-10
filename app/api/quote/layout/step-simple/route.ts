// app/api/quote/layout/step-simple/route.ts
//
// GET /api/quote/layout/step-simple?quote_no=Q-...
//
// RFM/LOCK RULE (Phase 1):
//   - Only enforce geometry_hash match when quote.locked === true.
//   - When unlocked, allow export (no hash gate).
//
// DEMO BYPASS (2026-04):
//   - Q-DEMO- quotes are allowed without auth (default tenant).
//   - Demo quotes have no STEP data so this returns 404 gracefully.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { computeGeometryHash, embedGeometryHashInStep } from "@/app/lib/layout/exports";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
  locked?: boolean | null;
  geometry_hash?: string | null;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";
  if (!quoteNo) {
    return bad(
      { ok: false, error: "MISSING_QUOTE_NO", message: "No quote_no was provided in the query string." },
      400,
    );
  }

  // ── Demo bypass ──────────────────────────────────────────────────────────
  const isDemoQuote = quoteNo.startsWith("Q-DEMO-");
  let tenantId: number;
  let userRole = "";

  if (isDemoQuote) {
    const tenantRow = await one<{ id: number }>(
      `SELECT id FROM public.tenants WHERE active = true ORDER BY id ASC LIMIT 1`,
      [],
    );
    if (!tenantRow) {
      return bad({ ok: false, error: "NO_TENANT", message: "No active tenant found." }, 500);
    }
    tenantId = tenantRow.id;
  } else {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "UNAUTHENTICATED" }, 401);
    userRole = (user.role || "").toLowerCase();
    tenantId = user.tenant_id;
  }
  // ── End demo bypass ───────────────────────────────────────────────────────

  try {
    const quote = await one<QuoteRow>(
      `
      select id, quote_no, locked, geometry_hash
      from quotes
      where quote_no = $1
        and tenant_id = $2
      `,
      [quoteNo, tenantId],
    );

    if (!quote) {
      return bad({ ok: false, error: "NOT_FOUND", message: `No quote found with number ${quoteNo}.` }, 404);
    }

    const layoutPkg = await one<LayoutPkgRow>(
      `
      select id, quote_id, layout_json, notes, svg_text, dxf_text, step_text, created_at
      from quote_layout_packages
      where quote_id = $1
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    if (!layoutPkg) {
      return bad(
        {
          ok: false,
          error: "LAYOUT_NOT_FOUND",
          message: "No layout has been saved for this quote yet. Try applying a layout first.",
        },
        404,
      );
    }

    // Staff/admin gate — only applied for non-demo quotes
    if (!isDemoQuote) {
      const isAdmin = userRole === "admin";
      const isStaff = isAdmin || userRole === "sales" || userRole === "cs";

      if (quote.locked) {
        if (!isAdmin) return bad({ ok: false, error: "FORBIDDEN", message: "Locked exports are admin-only." }, 403);
      } else {
        if (!isStaff) return bad({ ok: false, error: "FORBIDDEN", message: "Export access denied." }, 403);
      }
    }

    const storedHash = typeof quote.geometry_hash === "string" ? quote.geometry_hash : "";
    const layoutHash = computeGeometryHash(layoutPkg.layout_json);

    // ✅ Only enforce hash match when locked
    if (quote.locked) {
      if (!storedHash || layoutHash !== storedHash) {
        return bad(
          { ok: false, error: "GEOMETRY_HASH_MISMATCH", message: "Layout geometry does not match the locked hash." },
          409,
        );
      }
    }

    const effectiveHash = quote.locked ? storedHash : layoutHash;
    const stepText = embedGeometryHashInStep(layoutPkg.step_text ?? "", effectiveHash);

    if (!stepText || stepText.trim().length === 0) {
      return bad(
        {
          ok: false,
          error: "STEP_NOT_AVAILABLE",
          message: "No STEP data has been saved for this quote yet. Try clicking Apply to quote again.",
        },
        500,
      );
    }

    const fileName = `${quote.quote_no}-simple.step`;

    return new NextResponse(stepText, {
      status: 200,
      headers: {
        "Content-Type": "application/step",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("Error in /api/quote/layout/step-simple GET:", err);
    return bad(
      { ok: false, error: "SERVER_ERROR", message: "There was an unexpected problem returning the STEP file for this quote." },
      500,
    );
  }
}
