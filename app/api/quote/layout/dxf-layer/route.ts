// app/api/quote/layout/dxf-layer/route.ts
//
// GET /api/quote/layout/dxf-layer?quote_no=...&layer_index=0
//
// Server-gated per-layer DXF, mirroring /api/quote/layout/step-layer's
// RFM/LOCK rule and auth checks exactly:
//   - Locked exports are admin-only.
//   - Unlocked exports require staff (admin/sales/cs).
//   - Unauthenticated callers get 401 (except Q-DEMO- quotes).
//
// This exists because per-layer DXF was previously only ever computed
// client-side (admin page), with no server-side check at all — fine while
// only the staff-only /admin route used it, but not safe to reuse as-is for
// the customer-facing /quote page, which ships its JS bundle to logged-out
// visitors too. This route lets the customer page fetch a real, per-request
// authorized DXF instead of running the builder in the browser.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { computeGeometryHash } from "@/app/lib/layout/exports";
import { buildDxfForLayer } from "@/app/lib/layout/layer-dxf";

function jsonErr(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const quote_no = String(searchParams.get("quote_no") || "").trim();
    const layerIndexRaw = String(searchParams.get("layer_index") || "").trim();
    const layer_index = Number(layerIndexRaw);

    if (!quote_no) return jsonErr(400, "BAD_REQUEST", "Missing quote_no.");
    if (!Number.isInteger(layer_index) || layer_index < 0) return jsonErr(400, "BAD_REQUEST", "Invalid layer_index.");

    // ── Demo bypass (matches step-layer) ────────────────────────────────────
    const isDemoQuote = quote_no.startsWith("Q-DEMO-");
    let tenantId: number;
    let userRole = "";

    if (isDemoQuote) {
      const tenantRow = await one<{ id: number }>(
        `SELECT id FROM public.tenants WHERE active = true ORDER BY id ASC LIMIT 1`,
        [],
      );
      if (!tenantRow) return jsonErr(500, "NO_TENANT", "No active tenant found.");
      tenantId = tenantRow.id;
    } else {
      const user = await getCurrentUserFromRequest(req as any);
      if (!user) {
        return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
      }
      userRole = (user.role || "").toLowerCase();
      tenantId = user.tenant_id;
    }
    // ── End demo bypass ─────────────────────────────────────────────────────

    const pkg = await one<{
      quote_id: number;
      quote_no: string;
      layout_json: any;
      locked: boolean | null;
      geometry_hash: string | null;
    }>(
      `
      SELECT lp.quote_id, q.quote_no, q.locked, q.geometry_hash, lp.layout_json
      FROM public.quote_layout_packages lp
      JOIN public.quotes q ON q.id = lp.quote_id
      WHERE q.quote_no = $1
        AND q.tenant_id = $2
      ORDER BY lp.created_at DESC, lp.id DESC
      LIMIT 1
      `,
      [quote_no, tenantId],
    );

    if (!pkg) return jsonErr(404, "NOT_FOUND", "No layout package found for this quote.");

    // Staff/admin gate — only applied for non-demo quotes (matches step-layer).
    if (!isDemoQuote) {
      const isAdmin = userRole === "admin";
      const isStaff = isAdmin || userRole === "sales" || userRole === "cs";

      if (pkg.locked) {
        if (!isAdmin) return jsonErr(403, "FORBIDDEN", "Locked exports are admin-only.");
      } else {
        if (!isStaff) return jsonErr(403, "FORBIDDEN", "Export access denied.");
      }
    }

    // Only enforce hash match when locked (matches step-layer).
    if (pkg.locked) {
      const storedHash = typeof pkg.geometry_hash === "string" ? pkg.geometry_hash : "";
      const layoutHash = computeGeometryHash(pkg.layout_json);
      if (!storedHash || layoutHash !== storedHash) {
        return jsonErr(409, "GEOMETRY_HASH_MISMATCH", "Layout geometry does not match the locked hash.");
      }
    }

    // Target dims: scale to the primary (first) foam item's L/W, same as the
    // admin page's getTargetDims() (primaryItem = items[0]).
    const primaryItem = await one<{ length_in: string; width_in: string }>(
      `
      SELECT length_in, width_in
      FROM public.quote_items
      WHERE quote_id = $1
      ORDER BY id ASC
      LIMIT 1
      `,
      [pkg.quote_id],
    );

    const targetL = primaryItem ? Number(primaryItem.length_in) : NaN;
    const targetW = primaryItem ? Number(primaryItem.width_in) : NaN;
    const targetDims =
      Number.isFinite(targetL) && targetL > 0 && Number.isFinite(targetW) && targetW > 0
        ? { L: targetL, W: targetW }
        : undefined;

    const dxf = buildDxfForLayer(pkg.layout_json, layer_index, targetDims);
    if (!dxf) {
      return jsonErr(502, "DXF_FAILED", "Unable to build a DXF for this layer.");
    }

    const filename = `${quote_no}-layer-${layer_index + 1}.dxf`;

    return new Response(dxf, {
      status: 200,
      headers: {
        "content-type": "application/dxf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("GET /api/quote/layout/dxf-layer error:", err);
    return jsonErr(500, "SERVER_ERROR", String(err?.message ?? err));
  }
}
