// app/api/quote/layout/step-layer/route.ts
//
// GET /api/quote/layout/step-layer?quote_no=...&layer_index=0
//
// Behavior:
// - Loads latest layout package for the quote
// - Slices layout_json to include ONLY the requested layer (and that layer's cavities)
// - Forces block corner metadata based on *that layer's* crop flag (Path A fix)
// - Calls STEP microservice via buildStepFromLayout (normalized)
// - Returns attachment .step
//
// Notes:
// - This generates on-demand (no DB write) to keep Path A minimal.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { buildStepFromLayout } from "@/lib/cad/step";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { computeGeometryHash, embedGeometryHashInStep } from "@/app/lib/layout/exports";


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

function sliceLayoutToSingleLayer(layout: any, layerIndex: number): any {
  const layers = getLayers(layout);
  const layer = layers[layerIndex];
  if (!layer) return null;

  const out: any = { ...(layout || {}) };

  // Prefer stack if present, else mirror the container that exists.
  // (Keep Path A: always ensure stack exists since step normalizer keys off stack.)
  out.stack = [layer];

  // Keep other potential containers consistent (harmless if ignored)
  if (Array.isArray(layout.layers)) out.layers = [layer];
  if (Array.isArray((layout as any).foamLayers)) out.foamLayers = [layer];

  out.__layer_index = layerIndex;
  out.__mode = "layer";

  return out;
}

/**
 * PATH A:
 * The STEP normalizer/microservice currently honors ONLY block.cornerStyle/chamferIn.
 * The editor stores cropping per-layer (common), so per-layer STEP exports were
 * defaulting to square.
 *
 * Fix:
 * For a single-layer slice, force block corner metadata to match that layer’s crop flag.
 */
function coerceLayerCropToBlockCorners(slicedLayout: any) {
  if (!slicedLayout || typeof slicedLayout !== "object") return;

  const layers = getLayers(slicedLayout);
  const layer = layers[0];
  if (!layer) return;

  // Layer crop may be stored under different keys across revisions.
  const cropFlag =
    layer.cropCorners ??
    layer.croppedCorners ??
    layer.crop_corners ??
    layer.cropped_corners ??
    null;

  const roundFlag =
    layer.roundCorners ??
    layer.round_corners ??
    null;

  const roundRadiusRaw =
    layer.roundRadiusIn ?? layer.round_radius_in ?? layer.round_radius ?? null;

  // Some codepaths may store an explicit style.
  const layerCornerStyleRaw =
    typeof layer.cornerStyle === "string" ? layer.cornerStyle.trim().toLowerCase() : "";
  const layerCornerStyle =
    layerCornerStyleRaw === "chamfer" || layerCornerStyleRaw === "square"
      ? layerCornerStyleRaw
      : null;

  const wantsRound = typeof roundFlag === "boolean" ? roundFlag : false;
  const wantsChamfer =
    !wantsRound &&
    (layerCornerStyle === "chamfer" ? true : layerCornerStyle === "square" ? false : !!cropFlag);

  // Ensure block exists (it should in saved layouts, but keep defensive).
  if (!slicedLayout.block || typeof slicedLayout.block !== "object") slicedLayout.block = {};

  slicedLayout.block.cornerStyle = wantsChamfer ? "chamfer" : "square";
  slicedLayout.block.roundCorners = wantsRound;
  if (wantsRound) {
    const n = Number(roundRadiusRaw);
    slicedLayout.block.roundRadiusIn =
      Number.isFinite(n) && n > 0 ? n : 0.25;
  }

  // If chamfer is desired and chamferIn is missing, default to 1 inch
  // (matches our established “two-corner chamfer” behavior in exports).
  const existingChamfer =
    slicedLayout.block.chamferIn ?? slicedLayout.block.chamfer_in ?? null;

  if (wantsChamfer) {
    const n = Number(existingChamfer);
    if (!Number.isFinite(n) || n <= 0) {
      slicedLayout.block.chamferIn = 1;
    } else {
      // normalize to chamferIn key so the step normalizer can pass it through
      slicedLayout.block.chamferIn = n;
    }
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUserFromRequest(req as any);
    const role = (user?.role || "").toLowerCase();
    const cadAllowed = role === "admin" || role === "sales" || role === "cs";

    if (!user) return jsonErr(401, "UNAUTHENTICATED", "Sign in required.");
    if (!cadAllowed) return jsonErr(403, "FORBIDDEN", "CAD access required.");

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
      locked: boolean | null;
      geometry_hash: string | null;
    }>(
      `
      SELECT q.quote_no, q.locked, q.geometry_hash, lp.layout_json
      FROM public.quote_layout_packages lp
      JOIN public.quotes q ON q.id = lp.quote_id
      WHERE q.quote_no = $1
      ORDER BY lp.created_at DESC, lp.id DESC
      LIMIT 1
    `,
      [quote_no],
    );

    if (!pkg) return jsonErr(404, "NOT_FOUND", "No layout package found for this quote.");

    if (!pkg.locked) return jsonErr(423, "LOCK_REQUIRED", "Layout must be locked before exports are allowed.");

    const storedHash = typeof pkg.geometry_hash === "string" ? pkg.geometry_hash : "";
    const layoutHash = computeGeometryHash(pkg.layout_json);
    if (!storedHash || layoutHash !== storedHash) {
      return jsonErr(409, "GEOMETRY_HASH_MISMATCH", "Layout geometry does not match the locked hash.");
    }

    const sliced = sliceLayoutToSingleLayer(pkg.layout_json, layer_index);
    if (!sliced) return jsonErr(404, "NOT_FOUND", "Layer not found for this quote layout.");

    // ✅ Path A fix: force block corner metadata from this layer’s crop flag
    coerceLayerCropToBlockCorners(sliced);

    const stepBase = await buildStepFromLayout(sliced, quote_no, null);
    if (!stepBase || stepBase.trim().length === 0) {
      return jsonErr(502, "STEP_FAILED", "STEP service did not return a STEP payload.");
    }
    const stepText = embedGeometryHashInStep(stepBase, storedHash || layoutHash);

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
