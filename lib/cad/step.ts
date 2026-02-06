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
// NEW (Path A, additive):
// - Preserve poly cavities: if a cavity has shape:"poly" (or points[] present),
//   pass points[] through and normalize shape to "poly" (unless explicitly circle).
//
// ENV:
//   STEP_SERVICE_URL = https://alex-io-step-service.onrender.com

export type CavityDef = {
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  x: number;
  y: number;

  // For poly cavities: normalized points in TOP-LEFT space (0..1)
  points?: Array<{ x: number; y: number }> | null;

  shape?: string | null;
  diameterIn?: number | null;

  // explicit rounded-rect support
  cornerRadiusIn?: number | null;

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
  units: "in";
  block: {
    lengthIn: number;
    widthIn: number;
    thicknessIn: number;
    cornerStyle?: "square" | "chamfer" | null;
    chamferIn?: number | null;
  };
  stack: FoamLayer[];
  materialLegend?: string | null;
  quoteNo?: string | null;
};

type StepServiceResponse = {
  ok: boolean;
  step_text?: string | null;
  error?: string | null;
};

function safePosNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeNorm01(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function normalizeShape(raw: any): "circle" | "rect" | "roundedRect" | "poly" | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  if (s === "circle" || s === "round") return "circle";

  // polygon synonyms
  if (s === "poly" || s === "polygon") return "poly";

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
    c?.rx, // sometimes used for rounded rect in SVG
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function coerceDiameterIn(c: any): number | null {
  const candidates = [
    c?.diameterIn,
    c?.diameter_in,
    c?.diameter,
    c?.dia,
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
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

      const rawPoints = Array.isArray((c as any).points) ? (c as any).points : null;
      const points = rawPoints
        ? rawPoints
            .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
            .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y))
        : null;

      // Shape can come from multiple keys
      const rawShape = c.shape ?? c.cavityShape ?? c.type ?? null;
      let shape = normalizeShape(rawShape);

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

      // If points exist, treat as polygon unless explicitly circle.
      if (points && points.length >= 3 && shape !== "circle") {
        shape = "poly";
      }

      // Default shape to rect if still unknown
      if (shape == null) shape = "rect";

      return {
        lengthIn,
        widthIn,
        depthIn,
        x,
        y,

        points: points && points.length ? points : null,

        shape,
        diameterIn: diameterIn ?? null,
        cornerRadiusIn: cornerRadiusIn ?? null,

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

  const cornerStyle = (blockRaw.cornerStyle ?? blockRaw.corner_style ?? null) as any;
  const chamferInRaw = blockRaw.chamferIn ?? blockRaw.chamfer_in ?? null;
  const chamferInNum = Number(chamferInRaw);
  const chamferIn =
    chamferInRaw != null && Number.isFinite(chamferInNum) && chamferInNum >= 0
      ? chamferInNum
      : null;

  let stackRaw: any[] = [];

  if (Array.isArray((layout as any).stack) && (layout as any).stack.length > 0) {
    stackRaw = (layout as any).stack;
  } else {
    // Legacy: promote top-level cavities into stack[0]
    const cavs = Array.isArray((layout as any).cavities) ? (layout as any).cavities : [];
    stackRaw = [
      {
        thicknessIn,
        label: "Layer 1",
        cavities: cavs,
      },
    ];
  }

  const stack: FoamLayer[] = stackRaw.map((layer) => {
    const t = safePosNumber(layer.thicknessIn ?? layer.thickness_in) ?? thicknessIn;
    const cavities = normalizeCavities(Array.isArray(layer.cavities) ? layer.cavities : []);
    const roundCorners = layer.roundCorners ?? layer.round_corners ?? null;
    const roundRadiusInRaw =
      layer.roundRadiusIn ?? layer.round_radius_in ?? layer.round_radius ?? null;
    const rr = Number(roundRadiusInRaw);
    const roundRadiusIn = Number.isFinite(rr) && rr > 0 ? rr : null;

    return {
      thicknessIn: t,
      label: typeof layer.label === "string" ? layer.label : null,
      cavities,
      roundCorners: roundCorners == null ? null : !!roundCorners,
      roundRadiusIn,
    };
  });

  return {
    units: "in",
    block: {
      lengthIn,
      widthIn,
      thicknessIn,
      cornerStyle: cornerStyle === "chamfer" ? "chamfer" : "square",
      chamferIn,
    },
    stack,
  };
}

export async function buildStepFromLayout(
  layout: any,
  quoteNo: string,
  materialLegend: string | null,
): Promise<string> {
  const payload = normalizeLayoutForStep(layout);

  if (!payload) {
    throw new Error("STEP: invalid layout payload");
  }

  payload.quoteNo = quoteNo;
  payload.materialLegend = materialLegend ?? null;

  const url = process.env.STEP_SERVICE_URL;
  if (!url) {
    throw new Error("STEP_SERVICE_URL missing");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as StepServiceResponse | null;

  if (!res.ok || !json?.ok || !json.step_text) {
    throw new Error(json?.error || `STEP service HTTP ${res.status}`);
  }

  return json.step_text;
}
