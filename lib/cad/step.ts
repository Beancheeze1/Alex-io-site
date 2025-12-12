// lib/cad/step.ts
//
// STEP exporter facade for foam layouts.
//
// NEW DESIGN (microservice-backed):
// --------------------------------
// Instead of hand-rolling STEP / BREP topology in TypeScript, we delegate
// geometry to a small external service that uses a real CAD kernel
// (e.g. CadQuery/OpenCascade) to:
//
//   - Build one solid per foam layer (stacked in Z).
//   - Cut all cavities as proper boolean differences.
//   - Export a robust .STEP file that opens cleanly in SolidWorks,
//     Bambu Studio, ABViewer, etc.
//
// This file exposes a single helper:
//
//   buildStepFromLayout(layout, quoteNo, materialLegend)
//
// which:
//   - Calls the STEP microservice with the raw layout JSON,
//   - Returns the STEP text (or null on error).
//
// The /api/quote/layout/apply route stores that STEP text into
// quote_layout_packages.step_text, and the /api/quote/layout/step*
// routes simply stream it back to the user.

export type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number; // normalized 0..1 across block length
  y: number; // normalized 0..1 across block width
};

export type FoamLayer = {
  thicknessIn: number;
  label?: string | null;
  cavities?: CavityDef[] | null;
};

export type LayoutForStep = {
  block: {
    lengthIn: number;
    widthIn: number;
    thicknessIn: number; // total stack height
  };
  stack: FoamLayer[];
  // legacy single-layer cavities (treated as top layer)
  cavities?: CavityDef[] | null;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function getStepServiceUrl(): string | null {
  const raw = process.env.STEP_SERVICE_URL;
  if (!raw || !raw.trim()) {
    console.error(
      "[STEP] Missing STEP_SERVICE_URL env var; cannot contact STEP microservice.",
    );
    return null;
  }
  // Normalise: no trailing slash so we can safely append paths.
  return raw.replace(/\/+$/, "");
}

/**
 * Call the external STEP microservice to build a STEP file from a layout.
 *
 * The microservice is expected to expose:
 *   POST {STEP_SERVICE_URL}/step-from-layout
 *   Body JSON:
 *     {
 *       "layout": { ...raw layout JSON... },
 *       "quoteNo": "Q-....",
 *       "materialLegend": "1.7# PE · Blue" | null
 *     }
 *
 *   Response JSON on success:
 *     { "ok": true, "step": "<full STEP text>" }
 *
 *   On failure it may return:
 *     { "ok": false, "error": "..." }
 *   or a non-JSON body; we treat any non-2xx or missing `step` as failure.
 */
export async function buildStepFromLayout(
  layout: any,
  quoteNo: string,
  materialLegend: string | null,
): Promise<string | null> {
  const baseUrl = getStepServiceUrl();
  if (!baseUrl) {
    return null;
  }

  const url = `${baseUrl}/step-from-layout`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        layout,
        quoteNo,
        materialLegend: materialLegend ?? null,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[STEP] Microservice responded with HTTP ${res.status}: ${text?.slice(
          0,
          400,
        )}`,
      );
      return null;
    }

    // Prefer JSON contract, but also support raw STEP text fallback.
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; step?: unknown }
        | null;

      if (json && json.ok && isNonEmptyString(json.step)) {
        return json.step;
      }

      console.error(
        "[STEP] Microservice JSON response missing `ok:true` and `step` string.",
      );
      return null;
    } else {
      // Assume raw STEP text.
      const text = await res.text();
      if (isNonEmptyString(text)) {
        return text;
      }
      console.error("[STEP] Microservice returned empty STEP text body.");
      return null;
    }
  } catch (err: any) {
    console.error("[STEP] Error calling STEP microservice:", err);
    return null;
  }
}
