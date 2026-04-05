// app/api/quote/export-3view-pdf/route.ts
//
// Generate a 3-view technical drawing PDF for a quote
// Exports alongside DXF and STEP files
//
// GET /api/quote/export-3view-pdf?quote_no=Q-12345
//
// Returns: PDF file download

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { generate3ViewPDF, type Drawing3DInput, type Layer3D, type Cavity3D } from "@/lib/pdf/threeview";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { requirePlan, planGateResponse, PlanGateError } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  locked: boolean | null;
};

type LayoutRow = {
  id: number;
  quote_id: number;
  layout_json: any;
};

type ItemRow = {
  id: number;
  material_name: string | null;
  length_in: string;
  width_in: string;
  height_in: string;
  notes: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const quoteNo = req.nextUrl.searchParams.get("quote_no");

    if (!quoteNo) {
      return err("MISSING_QUOTE_NO", "Provide quote_no parameter", 400);
    }

    // Auth + permissions - only admin/sales/cs can export CAD
    const user = await getCurrentUserFromRequest(req);
    if (!user) {
      return err("UNAUTHENTICATED", "Login required.", 401);
    }

    const role = (user?.role || "").toLowerCase();
    const cadAllowed = role === "admin" || role === "sales" || role === "cs";

    if (!cadAllowed) {
      return err("PERMISSION_DENIED", "CAD exports require admin/sales/cs role", 403);
    }

    // ── Plan gate: CAD exports require Pro or Shop ─────────────────────────
    try {
      await requirePlan(user.tenant_id, "pro", "CAD / 3-view PDF exports");
    } catch (e) {
      if (e instanceof PlanGateError) {
        return NextResponse.json(planGateResponse(e), { status: 402 });
      }
      throw e;
    }
    // ── End plan gate ──────────────────────────────────────────────────────

    // Fetch quote (tenant-scoped)
    const quote = await one<QuoteRow>(
      `
      SELECT id, quote_no, customer_name, locked
      FROM quotes
      WHERE quote_no = $1
        AND tenant_id = $2
      `,
      [quoteNo, user.tenant_id],
    );

    if (!quote) {
      return err("QUOTE_NOT_FOUND", `Quote ${quoteNo} not found`, 404);
    }

    // Fetch layout
    const layout = await one<LayoutRow>(
      `
      SELECT id, quote_id, layout_json
      FROM quote_layout_packages
      WHERE quote_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [quote.id],
    );

    if (!layout || !layout.layout_json) {
      return err("NO_LAYOUT", "Quote has no layout to export", 404);
    }

    // Fetch items for material names
    const items = await q<ItemRow>(
      `
      SELECT
        qi.id,
        m.name as material_name,
        qi.length_in,
        qi.width_in,
        qi.height_in,
        qi.notes
      FROM quote_items qi
      LEFT JOIN materials m ON m.id = qi.material_id
      WHERE qi.quote_id = $1
      ORDER BY qi.id ASC
      `,
      [quote.id],
    );

    // Convert layout to 3D drawing input
    const drawingInput = layoutToDrawingInput(layout.layout_json, quote, items);

    if (!drawingInput) {
      return err("CONVERSION_FAILED", "Could not convert layout to 3D drawing", 500);
    }

    // Generate PDF
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generate3ViewPDF(drawingInput);
    } catch (e: any) {
      console.error("3-view PDF generation failed:", e);
      return err("PDF_GENERATION_FAILED", String(e?.message || e), 500);
    }

    // Return as downloadable file
    const filename = `${quoteNo}_3View_Drawing.pdf`;

    // Convert Buffer to Uint8Array for NextResponse
    const uint8Array = new Uint8Array(pdfBuffer);

    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  } catch (e: any) {
    console.error("export-3view-pdf exception:", e);
    return err("EXPORT_EXCEPTION", String(e?.message || e), 500);
  }
}

/**
 * Convert layout JSON to Drawing3DInput format
 */
function layoutToDrawingInput(layoutJson: any, quote: QuoteRow, items: ItemRow[]): Drawing3DInput | null {
  try {
    const block = layoutJson?.block || layoutJson?.Block || {};
    const blockRaw = block;

    const lengthIn = Number(block.lengthIn || block.length_in || block.length || 0);
    const widthIn = Number(block.widthIn || block.width_in || block.width || 0);
    const heightIn = Number(
      block.thicknessIn || block.thickness_in || block.heightIn || block.height_in || block.height || 0,
    );

    if (lengthIn <= 0 || widthIn <= 0 || heightIn <= 0) {
      return null;
    }

    // Get layers from stack or create single layer
    const stack = layoutJson?.stack || layoutJson?.layers || [];
    const layers: Layer3D[] = [];

    if (stack.length > 0) {
      for (let i = 0; i < stack.length; i++) {
        const layerData = stack[i];
        // BUG FIX: use nullish coalescing so a real 0 value doesn't fall through,
        // and check multiple possible key names your layout JSON may use.
        const thicknessIn = Number(
          layerData?.thicknessIn ?? layerData?.thickness_in ?? layerData?.thickIn ?? 0
        );

        if (thicknessIn <= 0) continue;

        // BUG FIX: don't collapse to items[0] for every extra layer — that causes
        // later layers to show the first layer's material name. Use a safe per-index
        // lookup with a label fallback instead.
        const item = items[i] ?? null;
        const materialName = item?.material_name || `Layer ${i + 1}`;

        const cavities: Cavity3D[] = [];
        const cavs = layerData?.cavities || [];

        for (const cav of cavs) {
          // Normalize shape to canonical camelCase — toLowerCase alone breaks "roundedRect"
          const shapeLower = (cav.shape || "rect").toLowerCase();
          const shape = shapeLower === "roundedrect" ? "roundedRect"
                      : shapeLower === "roundrect"   ? "roundedRect"
                      : shapeLower;
          const x = Number(cav.x || 0);
          const y = Number(cav.y || 0);
          const lengthIn = Number(cav.lengthIn || cav.length_in || 0);
          const widthIn = Number(cav.widthIn || cav.width_in || 0);
          const depthIn = Number(cav.depthIn || cav.depth_in || thicknessIn);

          // BUG FIX: coerce cornerRadiusIn to a real number for roundedRect so the
          // renderer doesn't silently zero a null and draw a plain square cavity.
          const cornerRadiusInParsed = (shape === "roundedRect")
            ? Number(cav.cornerRadiusIn ?? cav.corner_radius_in ?? 0)
            : (cav.cornerRadiusIn ?? cav.corner_radius_in ?? undefined);

          cavities.push({
            id: cav.id || `cav_${i}_${cavities.length}`,
            shape: shape as any,
            x,
            y,
            lengthIn,
            widthIn,
            depthIn,
            diameterIn: cav.diameterIn || cav.diameter_in,
            cornerRadiusIn: cornerRadiusInParsed,
            points: cav.points,
            nestedCavities: cav.nestedCavities ?? cav.nested_cavities,
            label: cav.label || null,
          });
        }

        layers.push({
          id: layerData.id || `layer_${i}`,
          label: layerData.label || `L${i + 1}`,
          thicknessIn,
          materialName,
          cavities,
          cropCorners: layerData.cropCorners ?? layerData.crop_corners ?? false,
          roundCorners: layerData.roundCorners ?? layerData.round_corners ?? false,
          roundRadiusIn: layerData.roundRadiusIn ?? layerData.round_radius_in ?? null,
        });
      }
    } else {
      // Single layer fallback
      const cavities: Cavity3D[] = [];
      const cavs = layoutJson?.cavities || [];

      for (let i = 0; i < cavs.length; i++) {
        const cav = cavs[i];
        // Normalize shape to canonical camelCase — toLowerCase alone breaks "roundedRect"
        const shapeLower = (cav.shape || "rect").toLowerCase();
        const shape = shapeLower === "roundedrect" ? "roundedRect"
                    : shapeLower === "roundrect"   ? "roundedRect"
                    : shapeLower;
        const x = Number(cav.x || 0);
        const y = Number(cav.y || 0);
        const lengthIn = Number(cav.lengthIn || cav.length_in || 0);
        const widthIn = Number(cav.widthIn || cav.width_in || 0);
        const depthIn = Number(cav.depthIn || cav.depth_in || heightIn);

        // BUG FIX: coerce cornerRadiusIn to a real number for roundedRect
        const cornerRadiusInParsed = (shape === "roundedRect")
          ? Number(cav.cornerRadiusIn ?? cav.corner_radius_in ?? 0)
          : (cav.cornerRadiusIn ?? cav.corner_radius_in ?? undefined);

        cavities.push({
          id: cav.id || `cav_${i}`,
          shape: shape as any,
          x,
          y,
          lengthIn,
          widthIn,
          depthIn,
          diameterIn: cav.diameterIn || cav.diameter_in,
          cornerRadiusIn: cornerRadiusInParsed,
          points: cav.points,
          nestedCavities: cav.nestedCavities ?? cav.nested_cavities,
          label: cav.label || null,
        });
      }

      const materialName = items[0]?.material_name || "Foam";

      layers.push({
        id: "layer_1",
        label: "L1",
        thicknessIn: heightIn,
        materialName,
        cavities,
      });
    }

    const revision = quote.locked ? "A" : "AS";
    const date = new Date().toISOString().split("T")[0];

    return {
      quoteNo: quote.quote_no,
      customerName: quote.customer_name,
      block: {
        lengthIn, widthIn, heightIn,
        cornerStyle: blockRaw.cornerStyle || blockRaw.corner_style || null,
        chamferIn: blockRaw.chamferIn || blockRaw.chamfer_in || null,
        roundCorners: blockRaw.roundCorners || blockRaw.round_corners || false,
        roundRadiusIn: blockRaw.roundRadiusIn || blockRaw.round_radius_in || null,
      },
      layers,
      revision,
      date,
      notes: [],
    };
  } catch (e) {
    console.error("layoutToDrawingInput conversion error:", e);
    return null;
  }
}