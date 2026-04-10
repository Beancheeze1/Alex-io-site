// app/api/quote/layout/step/route.ts
//
// Download the latest STEP file for a quote.
//
// GET /api/quote/layout/step?quote_no=Q-....
//
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Finds the most recent quote_layout_packages row for that quote
//     that has a non-null step_text
//   - Returns the STEP text as a file download
//
// RFM/LOCK RULE (Phase 1):
//   - Only enforce geometry_hash match when quote.locked === true.
//   - When unlocked, allow export (no hash gate).
//
// DEMO BYPASS (2026-04):
//   - Q-DEMO- quotes are allowed without auth (default tenant).
//   - Demo quotes have no STEP data, so this will return 404 gracefully.
//   - Staff role gate is skipped for demo; they can never export anyway.

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
  step_text: string | null;
  created_at: string;
  layout_json: any;
};

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";
  if (!quoteNo) {
    return json(
      {
        ok: false,
        error: "MISSING_QUOTE_NO",
        message: "No quote_no was provided in the query string.",
      },
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
      return json({ ok: false, error: "NO_TENANT", message: "No active tenant found." }, 500);
    }
    tenantId = tenantRow.id;
    // userRole stays "" — demo quotes are never locked, so staff gate is skipped below
  } else {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
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
      return json(
        { ok: false, error: "QUOTE_NOT_FOUND", message: `No quote found with number ${quoteNo}.` },
        404,
      );
    }

    const pkg = await one<LayoutPkgRow>(
      `
      select step_text, created_at, layout_json
      from quote_layout_packages
      where quote_id = $1
        and step_text is not null
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    if (!pkg || !pkg.step_text) {
      return json(
        {
          ok: false,
          error: "STEP_NOT_FOUND",
          message: "No STEP file has been saved for this quote yet. Try applying a layout first.",
        },
        404,
      );
    }

    // Staff/admin gate — demo quotes never reach here (no STEP data), but guard anyway
    if (!isDemoQuote) {
      const isAdmin = userRole === "admin";
      const isStaff = isAdmin || userRole === "sales" || userRole === "cs";

      if (quote.locked) {
        if (!isAdmin) {
          return json({ ok: false, error: "FORBIDDEN", message: "Locked exports are admin-only." }, 403);
        }
      } else {
        if (!isStaff) {
          return json({ ok: false, error: "FORBIDDEN", message: "Export access denied." }, 403);
        }
      }
    }

    const storedHash = typeof quote.geometry_hash === "string" ? quote.geometry_hash : "";
    const layoutHash = computeGeometryHash(pkg.layout_json);

    // ✅ Only enforce hash match when locked
    if (quote.locked) {
      if (!storedHash || layoutHash !== storedHash) {
        return json(
          { ok: false, error: "GEOMETRY_HASH_MISMATCH", message: "Layout geometry does not match the locked hash." },
          409,
        );
      }
    }

    const effectiveHash = quote.locked ? storedHash : layoutHash;
    const filename = `${quote.quote_no || quoteNo}.step`;
    const stepText = embedGeometryHashInStep(pkg.step_text, effectiveHash);

    return new NextResponse(stepText, {
      status: 200,
      headers: {
        "Content-Type": "application/step",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Error in /api/quote/layout/step GET:", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: "There was an unexpected problem loading the STEP file for this quote.",
      },
      500,
    );
  }
}
