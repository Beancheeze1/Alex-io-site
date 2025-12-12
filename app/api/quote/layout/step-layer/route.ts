// app/api/quote/layout/step-layer/route.ts
//
// GET /api/quote/layout/step-layer?quote_no=...&layer_index=0
//
// Behavior:
// - Loads latest layout package for the quote
// - Slices layout_json to include ONLY the requested layer (and that layer's cavities)
// - Calls STEP microservice (via shared buildStepFromLayout facade)
// - Returns attachment .step
//
// Notes:
// - Generates on-demand (no DB write) to keep Path A minimal.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { buildStepFromLayout } from "@/lib/cad/step";

function jsonErr(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function getLayers(layout: any): any[] {
  if (!layout || typeof layout !== "object") return [];
  if (Array.isArray(layout.stack) && layout.stack.length > 0) return layout.stack;
  if (Array.isArray(layout.layers) && layout.layers.length > 0) return layout.layers;
  if (Array.isArray((layout as any).foamLayers) && (layout as any).foamLayers.length > 0)
    return (layout as any).foamLayers;
  return [];
}

function sliceLayoutToSingleLayer(layout: any, layerIndex: number): any | null {
  const layers = getLayers(layout);
  const layer = layers[layerIndex];
  if (!layer) return null;

  // Clone shallowly
  const out: any = { ...(layout || {}) };

  // Force a single canonical layers container to avoid ambiguity/desync.
  // The STEP facade (lib/cad/step.ts) normalizes stack[].
  out.stack = [layer];
  delete out.layers;
  delete out.foamLayers;

  // IMPORTANT: exporting a *single layer* means the block thickness should match
  // that layer thickness, not the total stack thickness.
  const t =
    Number((layer as any)?.thicknessIn ?? (layer as any)?.thickness_in ?? (layer as any)?.thickness ?? 0) || 0;

  if (out.block && t > 0) {
    // preserve existing L/W; override thickness only
    out.block = { ...(out.block || {}) };
    out.block.thicknessIn = t;
    // also set common aliases (harmless if ignored)
    out.block.thickness_in = t;
    out.block.heightIn = t;
    out.block.height_in = t;
    out.block.height = t;
  }

  // Avoid dual cavity sources; the STEP facade will merge legacy cavities
  // into stack[0] when appropriate. For a sliced layer export, keep it clean.
  out.cavities = null;

  // Helpful metadata for downstream services (safe if ignored)
  out.__layer_index = layerIndex;
  out.__mode = "layer";

  return out;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const quote_no = String(searchParams.get("quote_no") || "").trim();
    const layerIndexRaw = String(searchParams.get("layer_index") || "").trim();
    const layer_index = Number(layerIndexRaw);

    if (!quote_no) return jsonErr(400, "BAD_REQUEST", "Missing quote_no.");
    if (!Number.isInteger(layer_index) || layer_index < 0)
      return jsonErr(400, "BAD_REQUEST", "Invalid layer_index.");

    const pkg = await one<{
      quote_no: string;
      layout_json: any;
    }>(
      `
      SELECT q.quote_no, lp.layout_json
      FROM public.quote_layout_packages lp
      JOIN public.quotes q ON q.id = lp.quote_id
      WHERE q.quote_no = $1
      ORDER BY lp.created_at DESC, lp.id DESC
      LIMIT 1
    `,
      [quote_no],
    );

    if (!pkg) return jsonErr(404, "NOT_FOUND", "No layout package found for this quote.");

    const sliced = sliceLayoutToSingleLayer(pkg.layout_json, layer_index);
    if (!sliced) return jsonErr(404, "NOT_FOUND", "Layer not found for this quote layout.");

    // Use the shared STEP facade so behavior matches Apply-to-quote STEP.
    const stepText = await buildStepFromLayout(sliced, quote_no, null);
    if (!stepText || stepText.trim().length === 0) {
      return jsonErr(502, "STEP_EMPTY", "STEP service returned empty STEP body.");
    }

    const filename = `${quote_no}-layer-${layer_index + 1}.step`;

    return new Response(stepText, {
      status: 200,
      headers: {
        "content-type": "application/step",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("GET /api/quote/layout/step-layer error:", err);
    return jsonErr(500, "SERVER_ERROR", String(err?.message ?? err));
  }
}
