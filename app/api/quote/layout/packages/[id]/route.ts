// app/api/quote/layout/packages/[id]/route.ts
//
// GET /api/quote/layout/packages/[id]?quote_no=Q-AI-...
//
// Returns the full layout JSON for a specific package.
// ADMIN ONLY - Used when admin selects a package to seed from the dropdown.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PackageRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  // Admin-only check
  const user = await getCurrentUserFromRequest(req as any);
  const role = (user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  if (!user) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  if (!isAdmin) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Admin access required." },
      { status: 403 },
    );
  }

  // Handle both async and sync params (Next.js 15 compatibility)
  const params = context.params instanceof Promise ? await context.params : context.params;
  const packageId = parseInt(params.id, 10);
  const { searchParams } = new URL(req.url);
  const quoteNo = searchParams.get("quote_no")?.trim() || "";

  if (!Number.isFinite(packageId) || packageId <= 0) {
    return NextResponse.json(
      { ok: false, error: "INVALID_PACKAGE_ID", message: `Invalid package ID: ${params.id}` },
      { status: 400 },
    );
  }

  if (!quoteNo) {
    return NextResponse.json(
      { ok: false, error: "MISSING_QUOTE_NO", message: "quote_no parameter is required" },
      { status: 400 },
    );
  }

  // Load the specific package, verifying it belongs to the correct quote (tenant-scoped)
  const pkg = await one<PackageRow>(
    `
    SELECT 
      lp.id,
      lp.quote_id,
      lp.layout_json,
      lp.notes,
      lp.svg_text,
      lp.dxf_text,
      lp.step_text,
      lp.created_at
    FROM quote_layout_packages lp
    JOIN quotes q ON q.id = lp.quote_id
    WHERE lp.id = $1
      AND q.quote_no = $2
      AND q.tenant_id = $3
    `,
    [packageId, quoteNo, user.tenant_id],
  );

  if (!pkg) {
    return NextResponse.json(
      { ok: false, error: "PACKAGE_NOT_FOUND", message: `Package ${packageId} not found for quote ${quoteNo}` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    package: {
      id: pkg.id,
      quoteId: pkg.quote_id,
      layout: pkg.layout_json,
      notes: pkg.notes,
      createdAt: pkg.created_at,
    },
  });
}