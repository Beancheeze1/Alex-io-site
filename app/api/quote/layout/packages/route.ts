// app/api/quote/layout/packages/route.ts
//
// GET /api/quote/layout/packages?quote_no=Q-AI-...
//
// Returns all layout packages for a quote with metadata.
// ADMIN ONLY - Used by admin area to load previous layouts during revisions.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type PackageRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  created_at: string;
  created_by_user_id: number | null;
};

export async function GET(req: NextRequest) {
  // Admin-only check
  const user = await getCurrentUserFromRequest(req as any);
  const role = (user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }
  
  if (!isAdmin) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Admin access required." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const quoteNo = searchParams.get("quote_no")?.trim() || "";

  if (!quoteNo) {
    return NextResponse.json(
      { ok: false, error: "MISSING_QUOTE_NO" },
      { status: 400 }
    );
  }

  // Look up quote
  const quote = await one<QuoteRow>(
    `SELECT id, quote_no FROM quotes WHERE quote_no = $1`,
    [quoteNo]
  );

  if (!quote) {
    return NextResponse.json(
      { ok: false, error: "QUOTE_NOT_FOUND" },
      { status: 404 }
    );
  }

  // Load all packages for this quote, ordered by creation date
  const packages = await q<PackageRow>(
    `
    SELECT 
      id,
      quote_id,
      layout_json,
      notes,
      created_at,
      created_by_user_id
    FROM quote_layout_packages
    WHERE quote_id = $1
    ORDER BY created_at ASC, id ASC
    `,
    [quote.id]
  );

  // Load facts to get revision context
  const facts: any = await loadFacts(quoteNo);

  // Build response with package metadata
  const items = packages.map((pkg, index) => {
    const layout = pkg.layout_json || {};
    const block = layout.block || {};

    // Format block dimensions
    const blockLabel = `${block.lengthIn || 0}×${block.widthIn || 0}×${block.thicknessIn || 0}"`;

    // Count cavities (support both single-layer and multi-layer)
    let cavityCount = 0;
    if (Array.isArray(layout.cavities)) {
      cavityCount = layout.cavities.length;
    }
    if (Array.isArray(layout.stack)) {
      cavityCount = layout.stack.reduce(
        (sum: number, layer: any) => sum + (layer.cavities?.length || 0),
        0
      );
    }

    // Count layers
    const layerCount = Array.isArray(layout.stack) ? layout.stack.length : 1;

    return {
      id: pkg.id,
      packageNumber: index + 1,
      blockLabel,
      cavityCount,
      layerCount,
      notes: pkg.notes || null,
      createdAt: pkg.created_at,
    };
  });

  return NextResponse.json({
    ok: true,
    quoteNo,
    currentRevision: facts?.revision || facts?.stage_rev || "AS",
    packages: items,
  });
}