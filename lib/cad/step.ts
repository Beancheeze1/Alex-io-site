// lib/cad/step.ts
//
// STEP exporter facade for foam layouts (microservice-backed).
//
// Key fix:
// - Normalize legacy layouts (block + cavities, no stack) into the microservice
//   schema (block + stack[0] + cavities optional).
// - NEW: Preserve cavity shape metadata (circle vs rect) so circles remain circles.
//
// ENV:
//   STEP_SERVICE_URL = https://alex-io-step-service.onrender.com

export type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number; // normalized 0..1 across block length
  y: number; // normalized 0..1 across block width

  // NEW
  shape?: string | null; // "rect" | "circle"
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

function normalizeShape(raw: any): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "circle" || s === "round") return "circle";
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";
  return s; // pass-through for forward-compat; microservice may ignore unknown
}

function normalizeCavities(raw: any): CavityDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CavityDef[] = [];

  for (const c of raw) {
    if (!c) continue;

    const lengthIn = safePosNumber(c.lengthIn ?? c.length_in ?? c.length);
    const widthIn = safePosNumber(c.widthIn ?? c.width_in ?? c.width);
    const depthIn = safePosNumber(
      c.depthIn ??
        c.depth_in ??
        c.depth ??
        c.heightIn ??
        c.height_in ??
        c.height,
    );
    const x = safeNorm01(c.x);
    const y = safeNorm01(c.y);

    if (!(lengthIn && widthIn && depthIn && x != null && y != null)) continue;

    const shape = normalizeShape(c.shape ?? c.cavityShape ?? c.type ?? null);
    const diameterIn = safePosNumber(c.diameterIn ?? c.diameter_in ?? c.diameter);

    out.push({
      lengthIn,
      widthIn,
      depthIn,
      x,
      y,
      shape,
      diameterIn: diameterIn ?? null,
    });
  }

  return out;
}

function normalizeLayoutForStep(layout: any): LayoutForStep | null {
  if (!layout || typeof layout !== "object") return null;

  const blockRaw = (layout as any).block ?? null;
  if (!blockRaw) return null;

  const lengthIn = safePosNumber(blockRaw.lengthIn ?? blockRaw.length_in ?? blockRaw.length);
  const widthIn = safePosNumber(blockRaw.widthIn ?? blockRaw.width_in ?? blockRaw.width);
  const thicknessIn = safePosNumber(
    blockRaw.thicknessIn ??
      blockRaw.thickness_in ??
      blockRaw.heightIn ??
      blockRaw.height_in ??
      blockRaw.thickness ??
      blockRaw.height,
  );

  if (!lengthIn || !widthIn || !thicknessIn) return null;

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

  const legacyCavs = normalizeCavities((layout as any).cavities);

  if (normalizedStack.length === 0) {
    normalizedStack.push({
      thicknessIn,
      label: "Foam layer",
      cavities: legacyCavs.length ? legacyCavs : null,
    });
    return {
      block: { lengthIn, widthIn, thicknessIn },
      stack: normalizedStack,
      cavities: null,
    };
  }

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
      console.error(`[STEP] Microservice HTTP ${res.status}: ${text?.slice(0, 600)}`, { quoteNo });
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
