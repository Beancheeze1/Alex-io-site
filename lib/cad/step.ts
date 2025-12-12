// lib/cad/step.ts
//
// STEP exporter facade for foam layouts (microservice-backed).
//
// Key fixes:
// - Normalize legacy layouts (block + cavities, no stack) into the microservice
//   schema (block + stack[0] + cavities optional).
// - Preserve cavity shape metadata (circle vs rectangle) so circles don't export as squares.
// - Preserve diameterIn for circle cavities when available.
//
// ENV:
//   STEP_SERVICE_URL = https://alex-io-step-service.onrender.com

export type CavityShape = "rect" | "circle";

export type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number; // normalized 0..1 across block length
  y: number; // normalized 0..1 across block width

  // NEW: optional shape support (safe if ignored by service)
  shape?: CavityShape | null;

  // NEW: for circles (diameter in inches). If omitted and shape==="circle",
  // we fall back to min(lengthIn,widthIn).
  diameterIn?: number | null;
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
  cavities?: CavityDef[] | null; // legacy top-level cavities
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function safePosNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeNorm01(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function normalizeShape(raw: any): CavityShape | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "circle" || s === "round" || s === "circular") return "circle";
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";
  return null;
}

function normalizeCavities(raw: any): CavityDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CavityDef[] = [];

  for (const c of raw) {
    if (!c) continue;

    const lengthIn = safePosNumber((c as any).lengthIn ?? (c as any).length_in ?? (c as any).length);
    const widthIn = safePosNumber((c as any).widthIn ?? (c as any).width_in ?? (c as any).width);
    const depthIn = safePosNumber(
      (c as any).depthIn ??
        (c as any).depth_in ??
        (c as any).depth ??
        (c as any).heightIn ??
        (c as any).height_in ??
        (c as any).height,
    );

    const x = safeNorm01((c as any).x);
    const y = safeNorm01((c as any).y);

    if (!lengthIn || !widthIn || !depthIn || x == null || y == null) continue;

    // NEW: shape + diameter passthrough
    const shape =
      normalizeShape((c as any).shape) ??
      normalizeShape((c as any).cavityShape) ??
      normalizeShape((c as any).kind) ??
      normalizeShape((c as any).type) ??
      null;

    const diameterRaw =
      (c as any).diameterIn ?? (c as any).diameter_in ?? (c as any).diameter ?? null;
    let diameterIn = diameterRaw == null ? null : safePosNumber(diameterRaw);

    // If declared circle but no diameter, infer from min(length,width)
    if (shape === "circle" && diameterIn == null) {
      diameterIn = Math.min(lengthIn, widthIn);
    }

    out.push({
      lengthIn,
      widthIn,
      depthIn,
      x,
      y,
      shape: shape ?? null,
      diameterIn: diameterIn ?? null,
    });
  }

  return out;
}

function normalizeLayoutForStep(layout: any): LayoutForStep | null {
  if (!layout || typeof layout !== "object") return null;

  const blockRaw = (layout as any).block ?? null;
  if (!blockRaw) return null;

  const lengthIn = safePosNumber((blockRaw as any).lengthIn ?? (blockRaw as any).length_in ?? (blockRaw as any).length);
  const widthIn = safePosNumber((blockRaw as any).widthIn ?? (blockRaw as any).width_in ?? (blockRaw as any).width);
  const thicknessIn = safePosNumber(
    (blockRaw as any).thicknessIn ??
      (blockRaw as any).thickness_in ??
      (blockRaw as any).heightIn ??
      (blockRaw as any).height_in ??
      (blockRaw as any).thickness ??
      (blockRaw as any).height,
  );

  if (!lengthIn || !widthIn || !thicknessIn) return null;

  // Normalize stack layers if present
  const rawStack = Array.isArray((layout as any).stack) ? (layout as any).stack : [];
  const normalizedStack: FoamLayer[] = [];

  if (rawStack.length > 0) {
    for (const layer of rawStack) {
      if (!layer) continue;

      const t = safePosNumber(
        (layer as any).thicknessIn ??
          (layer as any).thickness_in ??
          (layer as any).heightIn ??
          (layer as any).height_in ??
          (layer as any).thickness ??
          (layer as any).height,
      );
      if (!t) continue;

      const label =
        typeof (layer as any).label === "string" && (layer as any).label.trim()
          ? (layer as any).label.trim()
          : null;

      const cavities = normalizeCavities((layer as any).cavities);
      normalizedStack.push({
        thicknessIn: t,
        label,
        cavities: cavities.length ? cavities : null,
      });
    }
  }

  // Legacy top-level cavities (some old layouts only have this)
  const legacyCavs = normalizeCavities((layout as any).cavities);

  // If stack is missing/empty, create a single layer so the microservice accepts it.
  if (normalizedStack.length === 0) {
    normalizedStack.push({
      thicknessIn,
      label: "Foam layer",
      cavities: legacyCavs.length ? legacyCavs : null,
    });
    return {
      block: { lengthIn, widthIn, thicknessIn },
      stack: normalizedStack,
      cavities: null, // already moved into the single layer
    };
  }

  // Otherwise keep legacy cavs as top-level (microservice may apply to idx==0),
  // but we also keep per-layer cavities as provided.
  return {
    block: { lengthIn, widthIn, thicknessIn },
    stack: normalizedStack,
    cavities: legacyCavs.length ? legacyCavs : null,
  };
}

function getStepServiceUrl(): string | null {
  const raw = process.env.STEP_SERVICE_URL;
  if (!raw || !raw.trim()) {
    console.error("[STEP] Missing STEP_SERVICE_URL env var; cannot contact STEP microservice.");
    return null;
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Calls external STEP microservice:
 *   POST {STEP_SERVICE_URL}/step-from-layout
 *   Body JSON: { layout, quoteNo, materialLegend }
 *   Response JSON: { ok:true, step:"..." }
 */
export async function buildStepFromLayout(
  layout: any,
  quoteNo: string,
  materialLegend: string | null,
): Promise<string | null> {
  const baseUrl = getStepServiceUrl();
  if (!baseUrl) return null;

  const normalized = normalizeLayoutForStep(layout);
  if (!normalized) {
    console.error("[STEP] Layout missing required block/size fields; cannot build STEP.", {
      quoteNo,
      hasBlock: !!layout?.block,
      hasStack: Array.isArray(layout?.stack),
    });
    return null;
  }

  const url = `${baseUrl}/step-from-layout`;

  // Small timeout so Apply-to-quote can't hang forever
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        layout: normalized,
        quoteNo,
        materialLegend: materialLegend ?? null,
      }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[STEP] Microservice HTTP ${res.status}: ${text?.slice(0, 600)}`, {
        quoteNo,
      });
      return null;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await res.json().catch(() => null)) as { ok?: boolean; step?: unknown } | null;
      if (json && json.ok && isNonEmptyString(json.step)) return json.step;
      console.error("[STEP] Microservice JSON missing ok:true and step string.", { quoteNo, json });
      return null;
    }

    const text = await res.text();
    if (isNonEmptyString(text)) return text;

    console.error("[STEP] Microservice returned empty STEP body.", { quoteNo });
    return null;
  } catch (err: any) {
    console.error("[STEP] Error calling STEP microservice:", err?.name || err, { quoteNo });
    return null;
  } finally {
    clearTimeout(t);
  }
}
