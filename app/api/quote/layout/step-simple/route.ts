// app/api/quote/layout/step-simple/route.ts
//
// GET /api/quote/layout/step-simple?quote_no=Q-...
//
// Originally intended to return a SIMPLE STEP file (BLOCK primitives only)
// for the latest layout on a quote. For now, to keep things minimal and
// avoid extra exporters, this route simply returns the latest saved STEP
// text from quote_layout_packages.step_text (the same data produced by
// buildStepFromLayoutFull in /api/quote/layout/apply).
//
// Important:
//   - Reads quote_layout_packages.step_text.
//   - Does NOT call any buildStepFromLayout* helpers directly.
//   - /api/quote/layout/step remains the primary BREP export endpoint.

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
  const user = await getCurrentUserFromRequest(req);
  const role = (user?.role || "").toLowerCase();

  if (!user) {
    return bad({ ok: false, error: "UNAUTHENTICATED" }, 401);
  }

  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";

  if (!quoteNo) {
    return bad(
      {
        ok: false,
        error: "MISSING_QUOTE_NO",
        message: "No quote_no was provided in the query string.",
      },
      400,
    );
  }

  try {
    const quote = await one<QuoteRow>(
      `
      select id, quote_no, locked, geometry_hash
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "NOT_FOUND",
          message: `No quote found with number ${quoteNo}.`,
        },
        404,
      );
    }

    const layoutPkg = await one<LayoutPkgRow>(
      `
      select
        id,
        quote_id,
        layout_json,
        notes,
        svg_text,
        dxf_text,
        step_text,
        created_at
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
          message:
            "No layout has been saved for this quote yet. Try applying a layout first.",
        },
        404,
      );
    }

    const isAdmin = role === "admin";
    const isStaff = isAdmin || role === "sales" || role === "cs";

    if (quote.locked) {
      if (!isAdmin) {
        return bad(
          { ok: false, error: "FORBIDDEN", message: "Locked exports are admin-only." },
          403,
        );
      }
    } else {
      if (!isStaff) {
        return bad(
          { ok: false, error: "FORBIDDEN", message: "Export access denied." },
          403,
        );
      }
    }

    const storedHash = typeof quote.geometry_hash === "string" ? quote.geometry_hash : "";
    const layoutHash = computeGeometryHash(layoutPkg.layout_json);
    if (!storedHash || layoutHash !== storedHash) {
      return bad(
        {
          ok: false,
          error: "GEOMETRY_HASH_MISMATCH",
          message: "Layout geometry does not match the locked hash.",
        },
        409,
      );
    }

    const stepText = embedGeometryHashInStep(layoutPkg.step_text ?? "", storedHash || layoutHash);

    if (!stepText) {
      return bad(
        {
          ok: false,
          error: "STEP_NOT_AVAILABLE",
          message:
            "No STEP data has been saved for this quote yet. Try clicking Apply to quote again.",
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
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem returning the STEP file for this quote.",
      },
      500,
    );
  }
}
