// lib/cad/step.ts
//
// STEP exporter facade for foam layouts (microservice-backed).
//
// Key fix:
// - Normalize legacy layouts (block + cavities, no stack) into the microservice
//   schema (block + stack[0] + cavities optional).
// - Preserve cavity shape metadata and ALSO provide alias keys so the STEP
//   microservice can recognize circles even if it expects different field names.
//
// NEW (Path A):
// - Thread block-level corner metadata through unchanged (cornerStyle/chamferIn).
//
// ENV:
//   STEP_SERVICE_URL = https://alex-io-step-service.onrender.com

export type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number;
  y: number;

  shape?: string | null;
  diameterIn?: number | null;

  // explicit rounded-rect support
  cornerRadiusIn?: number | null;

  // NEW: polygon cavities
  points?: { x: number; y: number }[] | null;

  // aliases for microservice
  cavityShape?: string | null;
  type?: string | null;
  radiusIn?: number | null;
  diameter?: number | null;
  r?: number | null;
};

export type FoamLayer = {
  thicknessIn: number;
  label?: string | null;
  cavities?: CavityDef[] | null;
  roundCorners?: boolean | null;
  roundRadiusIn?: number | null;
};

export type LayoutForStep = {
  block: {
    lengthIn: number;
    widthIn: number;
    thicknessIn: number; // total stack height

    // NEW (Path A, additive): pass-through only (microservice may ignore for now)
    cornerStyle?: string | null; // expected: "square" | "chamfer"
    chamferIn?: number | null; // inches
    roundCorners?: boolean | null;
    roundRadiusIn?: number | null;
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

function normalizeShape(raw: any): "circle" | "rect" | "roundedRect" | "poly" | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  if (s === "circle" || s === "round") return "circle";

  // common rect synonyms
  if (s === "rect" || s === "rectangle" || s === "square") return "rect";

  // rounded rect synonyms seen across UI/editor code
  if (
    s === "roundedrect" ||
    s === "rounded-rect" ||
    s === "rounded_rect" ||
    s === "roundrect"
  )
    return "roundedRect";

  if (s === "poly" || s === "polygon") return "poly";

  // If something else comes in, keep it null (we only send the canonical set)
  return null;
}

function coerceCornerRadiusIn(c: any): number | null {
  // Accept multiple keys; pick the first valid positive number.
  const candidates = [
    c?.cornerRadiusIn,
    c?.corner_radius_in,
    c?.corner_radius,
    c?.radiusIn, // some codepaths may use radiusIn for rounded rect
    c?.radius_in,
    c?.r,
    c?.rx, // sometimes svg-ish naming leaks into objects
    c?.ry,
  ];

  for (const v of candidates) {
    const n = safePosNumber(v);
    if (n != null) return n;
  }
  return null;
}

function coerceDiameterIn(c: any): number | null {
  const candidates = [c?.diameterIn, c?.diameter_in, c?.diameter, c?.dia, c?.d];

  for (const v of candidates) {
    const n = safePosNumber(v);
    if (n != null) return n;
  }
  return null;
}

function normalizeCavities(raw: any[]): CavityDef[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((c) => {
      if (!c) return null;

      const lengthIn = safePosNumber(c.lengthIn ?? c.length_in ?? c.length);
      const widthIn =
        safePosNumber(c.widthIn ?? c.width_in ?? c.width) ?? lengthIn;
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

      if (!lengthIn || !widthIn || !depthIn || x == null || y == null)
        return null;

      // Shape can come from multiple keys
      const rawShape = c.shape ?? c.cavityShape ?? c.type ?? null;
      let shape = normalizeShape(rawShape);

      let points: { x: number; y: number }[] | null = null;
      if (shape === "poly" && Array.isArray((c as any).points)) {
        const rawPts = (c as any).points as any[];
        const normalized = rawPts
          .map((p) => {
            const px = safeNorm01(p?.x);
            const py = safeNorm01(p?.y);
            if (px == null || py == null) return null;
            return { x: px, y: py };
          })
          .filter((v): v is { x: number; y: number } => !!v);

        if (normalized.length >= 3) points = normalized;
      }

      const cornerRadiusIn = coerceCornerRadiusIn(c);
      const diameterIn = coerceDiameterIn(c);

      // If we have a positive radius, treat as roundedRect unless it's explicitly a circle.
      if (cornerRadiusIn != null && cornerRadiusIn > 0) {
        if (shape !== "circle") shape = "roundedRect";
      }

      // If we have a diameter and not explicitly a rounded rect, treat as circle (service usually uses dia)
      if (diameterIn != null && diameterIn > 0) {
        if (shape == null || shape === "circle") shape = "circle";
      }

      // Default shape to rect if still unknown
      if (shape == null) shape = "rect";

      return {
        lengthIn,
        widthIn,
        depthIn,
        x,
        y,

        shape,
        diameterIn: diameterIn ?? null,
        cornerRadiusIn: cornerRadiusIn ?? null,
        points,

        // aliases for microservice
        cavityShape: shape,
        type: shape,
        radiusIn: cornerRadiusIn ?? null,
        r: cornerRadiusIn ?? null,
        diameter: diameterIn ?? null,
      } as CavityDef;
    })
    .filter((v): v is CavityDef => !!v);
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

  // NEW (Path A): pass-through only (do not infer)
  const cornerStyleRaw = typeof blockRaw.cornerStyle === "string" ? blockRaw.cornerStyle.trim() : "";
  const cornerStyle = cornerStyleRaw ? cornerStyleRaw : null;

  const chamferInNum =
    blockRaw.chamferIn != null || blockRaw.chamfer_in != null
      ? safePosNumber(blockRaw.chamferIn ?? blockRaw.chamfer_in)
      : null;

  const roundCornersRaw = blockRaw.roundCorners ?? blockRaw.round_corners ?? null;
  const roundRadiusRaw = blockRaw.roundRadiusIn ?? blockRaw.round_radius_in ?? blockRaw.round_radius ?? null;
  const roundCorners = typeof roundCornersRaw === "boolean" ? roundCornersRaw : null;
  const roundRadiusIn = safePosNumber(roundRadiusRaw);

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
      const layerRoundRaw =
        (layer as any).roundCorners ?? (layer as any).round_corners ?? null;
      const layerRadiusRaw =
        (layer as any).roundRadiusIn ??
        (layer as any).round_radius_in ??
        (layer as any).round_radius ??
        null;
      const roundCorners = typeof layerRoundRaw === "boolean" ? layerRoundRaw : null;
      const roundRadiusIn = safePosNumber(layerRadiusRaw);

      normalizedStack.push({
        thicknessIn: t,
        label,
        cavities: cavities.length ? cavities : null,
        roundCorners,
        roundRadiusIn: roundRadiusIn ?? null,
      });
    }
  }

  const legacyCavs = normalizeCavities((layout as any).cavities);

  const blockOut: LayoutForStep["block"] = {
    lengthIn,
    widthIn,
    thicknessIn,
    cornerStyle,
    chamferIn: chamferInNum,
    roundCorners,
    roundRadiusIn: roundRadiusIn ?? null,
  };

  if (normalizedStack.length === 0) {
    normalizedStack.push({
      thicknessIn,
      label: "Foam layer",
      cavities: legacyCavs.length ? legacyCavs : null,
    });
    return {
      block: blockOut,
      stack: normalizedStack,
      cavities: null,
    };
  }

  if (
    normalizedStack.length === 1 &&
    (blockOut.roundCorners == null || blockOut.roundRadiusIn == null)
  ) {
    const layerRaw = rawStack[0] ?? null;
    if (layerRaw) {
      const layerRoundRaw =
        (layerRaw as any).roundCorners ?? (layerRaw as any).round_corners ?? null;
      const layerRadiusRaw =
        (layerRaw as any).roundRadiusIn ??
        (layerRaw as any).round_radius_in ??
        (layerRaw as any).round_radius ??
        null;

      if (blockOut.roundCorners == null && typeof layerRoundRaw === "boolean") {
        blockOut.roundCorners = layerRoundRaw;
      }
      if (blockOut.roundRadiusIn == null) {
        const n = safePosNumber(layerRadiusRaw);
        if (n != null) blockOut.roundRadiusIn = n;
      }
    }
  }

  return {
    block: blockOut,
    stack: normalizedStack,
    cavities: legacyCavs.length ? legacyCavs : null,
  };
}

function getStepServiceUrl(): string | null {
  const raw = process.env.STEP_SERVICE_URL;
  if (!raw || !raw.trim()) {
    console.error(
      "[STEP] Missing STEP_SERVICE_URL env var; cannot contact STEP microservice.",
    );
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
