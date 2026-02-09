// app/api/quote/export-3view-pdf-layer/route.ts
//
// Generate a 3-view technical drawing PDF for a SINGLE layer
// Similar to the full-package export but only shows one layer
//
// GET /api/quote/export-3view-pdf-layer?quote_no=Q-12345&layer_index=0

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { generate3ViewPDF, type Drawing3DInput, type Layer3D, type Cavity3D } from "@/lib/pdf/threeview";
import { getCurrentUserFromRequest } from "@/lib/auth";

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
    const layerIndexStr = req.nextUrl.searchParams.get("layer_index");
    
    if (!quoteNo) {
      return err("MISSING_QUOTE_NO", "Provide quote_no parameter", 400);
    }
    
    if (layerIndexStr === null) {
      return err("MISSING_LAYER_INDEX", "Provide layer_index parameter", 400);
    }
    
    const layerIndex = parseInt(layerIndexStr, 10);
    if (!Number.isFinite(layerIndex) || layerIndex < 0) {
      return err("INVALID_LAYER_INDEX", "layer_index must be a non-negative integer", 400);
    }
    
    // Check permissions - only admin/sales/cs can export CAD
    const user = await getCurrentUserFromRequest(req);
    const role = (user?.role || "").toLowerCase();
    const cadAllowed = role === "admin" || role === "sales" || role === "cs";
    
    if (!cadAllowed) {
      return err("PERMISSION_DENIED", "CAD exports require admin/sales/cs role", 403);
    }
    
    // Fetch quote
    const quote = await one<QuoteRow>(
      `
      SELECT id, quote_no, customer_name, locked
      FROM quotes
      WHERE quote_no = $1
      `,
      [quoteNo]
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
      [quote.id]
    );
    
    if (!layout || !layout.layout_json) {
      return err("NO_LAYOUT", "Quote has no layout to export", 404);
    }
    
    // Fetch items for material names
    const items = await one<ItemRow>(
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
      LIMIT 1 OFFSET $2
      `,
      [quote.id, layerIndex]
    );
    
    // Convert layout to 3D drawing input for single layer
    const drawingInput = layoutToSingleLayerDrawing(
      layout.layout_json, 
      quote, 
      items, 
      layerIndex
    );
    
    if (!drawingInput) {
      return err("CONVERSION_FAILED", "Could not convert layer to 3D drawing", 500);
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
    const layerLabel = drawingInput.layers[0]?.label || `Layer${layerIndex + 1}`;
    const filename = `${quoteNo}_${layerLabel}_3View.pdf`;
    
    // Convert Buffer to Uint8Array for NextResponse
    const uint8Array = new Uint8Array(pdfBuffer);
    
    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
    
  } catch (e: any) {
    console.error("export-3view-pdf-layer exception:", e);
    return err("EXPORT_EXCEPTION", String(e?.message || e), 500);
  }
}

/**
 * Convert layout JSON to Drawing3DInput format for a SINGLE layer
 */
function layoutToSingleLayerDrawing(
  layoutJson: any,
  quote: QuoteRow,
  item: ItemRow | null,
  layerIndex: number
): Drawing3DInput | null {
  try {
    const block = layoutJson?.block || layoutJson?.Block || {};
    
    const lengthIn = Number(block.lengthIn || block.length_in || block.length || 0);
    const widthIn = Number(block.widthIn || block.width_in || block.width || 0);
    
    // Get the specific layer
    const stack = layoutJson?.stack || layoutJson?.layers || [];
    
    if (layerIndex >= stack.length) {
      return null;
    }
    
    const layerData = stack[layerIndex];
    const thicknessIn = Number(layerData?.thicknessIn || layerData?.thickness_in || 0);
    
    if (lengthIn <= 0 || widthIn <= 0 || thicknessIn <= 0) {
      return null;
    }
    
    const materialName = item?.material_name || `Layer ${layerIndex + 1}`;
    
    const cavities: Cavity3D[] = [];
    const cavs = layerData?.cavities || [];
    
    for (const cav of cavs) {
      const shape = (cav.shape || "rect").toLowerCase();
      const x = Number(cav.x || 0);
      const y = Number(cav.y || 0);
      const lengthIn = Number(cav.lengthIn || cav.length_in || 0);
      const widthIn = Number(cav.widthIn || cav.width_in || 0);
      const depthIn = Number(cav.depthIn || cav.depth_in || thicknessIn);
      
      cavities.push({
        id: cav.id || `cav_${cavities.length}`,
        shape: shape as any,
        x,
        y,
        lengthIn,
        widthIn,
        depthIn,
        diameterIn: cav.diameterIn || cav.diameter_in,
        points: cav.points,
        label: cav.label || null,
      });
    }
    
    const layer: Layer3D = {
      id: layerData.id || `layer_${layerIndex}`,
      label: layerData.label || `L${layerIndex + 1}`,
      thicknessIn,
      materialName,
      cavities,
    };
    
    const revision = quote.locked ? "A" : "AS";
    const date = new Date().toISOString().split("T")[0];
    
    return {
      quoteNo: quote.quote_no,
      customerName: quote.customer_name,
      block: { lengthIn, widthIn, heightIn: thicknessIn },
      layers: [layer], // Single layer only
      revision,
      date,
      notes: [],
    };
    
  } catch (e) {
    console.error("layoutToSingleLayerDrawing conversion error:", e);
    return null;
  }
}