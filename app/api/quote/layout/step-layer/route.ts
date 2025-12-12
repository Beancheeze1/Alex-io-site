// app/api/quote/layout/step-layer/route.ts
//
// GET /api/quote/layout/step-layer?quote_no=...&layer_index=0
//
// Behavior:
// - Loads latest layout package for the quote
// - Slices layout_json to include ONLY the requested layer (and that layer's cavities)
// - Calls STEP microservice
// - Returns attachment .step
//
// Notes:
// - This generates on-demand (no DB write) to keep Path A minimal.
// - If later you want caching, we can store per-layer STEP in a new table or a jsonb map.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { one } from "@/lib/db";

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

  // Clone shallowly; replace only the layers container
  const out: any = { ...(layout || {}) };

  if (Array.isArray(layout.stack)) out.stack = [layer];
  if (Array.isArray(layout.layers)) out.layers = [layer];
  if (Array.isArray((layout as any).foamLayers)) out.foamLayers = [layer];

  // Helpful metadata for downstream services (safe if ignored)
  out.__layer_index = layerIndex;
  out.__mode = "layer";

  return out;
}

async function callStepService(layoutJson: any): Promise<string> {
  const base = (process.env.STEP_SERVICE_URL || "").trim();
  if (!base) throw new Error("STEP_SERVICE_URL is not set");

  const candidates = [
    base.replace(/\/+$/, "") + "/api/step",
    base.replace(/\/+$/, "") + "/step",
  ];

  const payload = { layout: layoutJson };

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`STEP service ${res.status} ${res.statusText}: ${text || "(no body)"}`);
      }

      if (ct.includes("application/json")) {
        const json: any = await res.json();
        const stepText =
          (typeof json?.step_text === "string" && json.step_text) ||
          (typeof json?.step === "string" && json.step) ||
          (typeof json?.data === "string" && json.data) ||
          null;

        if (!stepText) {
          throw new Error("STEP service returned JSON but no step_text field was found.");
        }
        return stepText;
      } else {
        const stepText = await res.text();
        if (!stepText || stepText.trim().length === 0) {
          throw new Error("STEP service returned empty text.");
        }
        return stepText;
      }
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to call STEP service.");
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

    const stepText = await callStepService(sliced);

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
