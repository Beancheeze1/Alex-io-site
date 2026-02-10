// app/quote/layout/page.tsx
//
// Layout editor host page (wide).
// - Left: palette + notes + closest cartons preview
// - Center: large canvas + metrics row under layout header
// - Right: inspector + customer info + cavities list
// - Apply-to-quote behavior unchanged
//
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { CavityShape, LayoutModel } from "./editor/layoutTypes";
import { facesJsonToLayoutSeed } from "@/lib/forgeFacesSeed";
import { useLayoutModel } from "./editor/useLayoutModel";
import InteractiveCanvas from "./editor/InteractiveCanvas";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

type MaterialOption = {
  id: number;
  name: string;
  family: string;
  density_lb_ft3: number | null;
};

// NEW: suggested box types for the box suggester panel
type SuggestedBox = {
  sku: string;
  description: string;
  style: string;
  vendor_name?: string | null;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  fit_score: number;
  notes?: string | null;
};

type BoxSuggestState = {
  loading: boolean;
  error: string | null;
  bestRsc: SuggestedBox | null;
  bestMailer: SuggestedBox | null;
};

type GuidedStep = {
  id: string;
  label: string;
};

function useGuidedInput(steps: GuidedStep[]) {
  const [enabled, setEnabled] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);

  const start = React.useCallback(() => {
    setEnabled(true);
    setStepIndex(0);
  }, []);

  const stop = React.useCallback(() => {
    setEnabled(false);
  }, []);

  const next = React.useCallback(() => {
    setStepIndex((idx) => Math.min(idx + 1, steps.length - 1));
  }, [steps.length]);

  const prev = React.useCallback(() => {
    setStepIndex((idx) => Math.max(idx - 1, 0));
  }, []);

  const goTo = React.useCallback(
    (id: string) => {
      const idx = steps.findIndex((s) => s.id === id);
      if (idx >= 0) {
        setEnabled(true);
        setStepIndex(idx);
      }
    },
    [steps],
  );

  const finish = React.useCallback(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("guidedInputCompleted", "true");
      }
    } catch {}
    setEnabled(false);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const step = steps[stepIndex];
    if (!step) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const el = document.querySelector(`[data-guided="${step.id}"]`);
    if (!el) return;

    const timer = window.setTimeout(() => {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {}
    }, 40);

    return () => window.clearTimeout(timer);
  }, [enabled, stepIndex, steps]);

  return {
    enabled,
    stepIndex,
    steps,
    start,
    stop,
    next,
    prev,
    goTo,
    finish,
  };
}

/**
 * Normalize block dims from searchParams (dims= / block=)
 */
function normalizeDimsParam(raw: string | string[] | undefined): string {
  if (!raw) return "10x10x2";
  if (Array.isArray(raw)) {
    const first = raw.find((s) => s && s.trim());
    return first ? first.trim() : "10x10x2";
  }
  const trimmed = raw.trim();
  return trimmed || "10x10x2";
}

/**
 * Normalize cavity dims from searchParams (cavities= / cavity=)
 */
function normalizeCavitiesParam(raw: string | string[] | undefined): string {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    const cleaned = raw.map((s) => s.trim()).filter(Boolean);
    const unique: string[] = [];
    for (const val of cleaned) if (!unique.includes(val)) unique.push(val);
    return unique.join(";");
  }
  return raw.trim();
}

/**
 * Normalize layers from searchParams
 * Supports:
 *  - layers=1,4,1
 *  - layers=1;4;1
 *  - layer=1&layer=4&layer=1
 *  - layers=[{"thicknessIn":1,"label":"Bottom"},{"thicknessIn":4,"label":"Middle"},{"thicknessIn":1,"label":"Top"}]
 */
function parseLayersParam(
  raw: string | string[] | undefined,
): { thicknesses: number[]; labels: string[] } | null {
  if (!raw) return null;

  // Parse a "loose" numeric value out of a token that may contain quotes/units/punctuation
  // Examples handled: 1.5", 2in, 0.5., .5, "1.5\"",  3 inch
  const toNumberLoose = (val: any): number => {
    if (val == null) return NaN;
    const s = String(val).trim().toLowerCase();
    if (!s) return NaN;

    // Grab the first numeric chunk (supports leading dot)
    const m = s.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!m) return NaN;

    const n = Number(m[0]);
    return Number.isFinite(n) ? n : NaN;
  };

  // IMPORTANT:
  // If raw is a string[], it may represent repeated query params like:
  //   layer_thicknesses=1&layer_thicknesses=3&layer_thicknesses=0.5
  // We must combine ALL values, not just the first one.
  const s = Array.isArray(raw)
    ? raw
        .map((v) => (v ?? "").toString().trim())
        .filter(Boolean)
        .join(",")
    : raw.toString().trim();

  if (!s) return null;

  // JSON forms
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s);

      // Array of objects
      if (Array.isArray(parsed)) {
        const thicknesses: number[] = [];
        const labels: string[] = [];

        for (const item of parsed) {
          const t = toNumberLoose(item?.thicknessIn ?? item?.thickness ?? item?.t);
          if (Number.isFinite(t) && t > 0) {
            thicknesses.push(t);
            const lbl = (item?.label ?? item?.name ?? "").toString().trim();
            labels.push(lbl || `Layer ${thicknesses.length}`);
          }
        }

        return thicknesses.length > 0 ? { thicknesses, labels } : null;
      }

      // Object with thicknesses
      if (parsed && typeof parsed === "object") {
        const arr = (parsed as any).thicknesses ?? (parsed as any).layers ?? null;
        if (Array.isArray(arr)) {
          const thicknesses = arr
            .map((x: any) => toNumberLoose(x))
            .filter((n: number) => Number.isFinite(n) && n > 0);

          if (thicknesses.length === 0) return null;

          const labels = thicknesses.map((_, i) => `Layer ${i + 1}`);
          return { thicknesses, labels };
        }
      }
    } catch {
      // fall through to delimited
    }
  }

  // Delimited numeric list
  const parts = s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);

  const thicknesses = parts
    .map((x) => toNumberLoose(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (thicknesses.length === 0) return null;

  // Numeric layers only (no top/middle/bottom labels)
  const labels = thicknesses.map((_, i) => `Layer ${i + 1}`);
  return { thicknesses, labels };
}

/**
 * Read per-layer cavities from search params:
 *  - cavities_l1=1x1x.5;2x2x1
 *  - cavity_l2=... (repeatable)
 */

/**
 * Read customer prefill from search params:
 * Supported keys (any):
 *  - customer_name, name, customer
 *  - customer_email, email
 *  - customer_company, company
 *  - customer_phone, phone
 */

function readCustomerFromUrl(url: URL): {
  name: string;
  email: string;
  company: string;
  phone: string;
} {
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const all = url.searchParams
        .getAll(k)
        .map((s) => (s ?? "").trim())
        .filter(Boolean);
      if (all.length > 0) return all[0];

      const v = (url.searchParams.get(k) ?? "").trim();
      if (v) return v;
    }
    return "";
  };

  const first = pick(["first_name", "firstName", "fname"]);
  const last = pick(["last_name", "lastName", "lname"]);
  const combinedName =
    [first, last].map((s) => (s ?? "").trim()).filter(Boolean).join(" ").trim();

  return {
    name: pick(["customer_name", "customerName", "name", "customer"]) || combinedName,
    email: pick(["customer_email", "customerEmail", "email"]),
    company: pick([
      "customer_company",
      "customerCompany",
      "company",
      "company_name",
      "companyName",
      "organization",
    ]),
    phone: pick([
      "customer_phone",
      "customerPhone",
      "phone",
      "phone_number",
      "phoneNumber",
      "tel",
    ]),
  };

}

function readQtyFromUrl(url: URL): number | null {
  const keys = ["qty", "quantity", "q", "order_qty", "quote_qty"];
  for (const k of keys) {
    const raw = (url.searchParams.get(k) ?? "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function readNotesFromUrl(url: URL): string {
  const raw = url.searchParams.get("notes");
  if (!raw) return "";

  try {
    // URLSearchParams decodes %XX but leaves '+' intact
    return decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  } catch {
    return raw.replace(/\+/g, " ").trim();
  }
}



function readLayerCavitiesFromUrl(url: URL, layerIndex1Based: number): string {
  const keyA = `cavities_l${layerIndex1Based}`;
  const keyB = `cavity_l${layerIndex1Based}`;

  const parts: string[] = [];
  const a = url.searchParams.getAll(keyA).filter(Boolean);
  const b = url.searchParams.getAll(keyB).filter(Boolean);
  parts.push(...a, ...b);

  return normalizeCavitiesParam(parts);
}

const SNAP_IN = 0.125;
const WALL_IN = 0.5;
const CENTER_SNAP_IN = 0.0625; // 1/16" for centering only
const DEFAULT_ROUND_RADIUS_IN = 0.25;



function repairNullCavityXY(layout: LayoutModel): LayoutModel {
  try {
    if (!layout || typeof layout !== "object") return layout;

    const block: any = (layout as any).block;
    const Lb = Number(block?.lengthIn);
    const Wb = Number(block?.widthIn);
    if (!Number.isFinite(Lb) || Lb <= 0 || !Number.isFinite(Wb) || Wb <= 0) return layout;

    const isBad = (v: any) => {
      const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
      return !Number.isFinite(n);
    };

    const repairArray = (cavs: any[] | null | undefined): any[] | null | undefined => {
      if (!Array.isArray(cavs) || cavs.length === 0) return cavs;

      let anyBad = false;
      for (const c of cavs) {
        if (!c || isBad((c as any).x) || isBad((c as any).y)) { anyBad = true; break; }
      }
      if (!anyBad) return cavs;

      const count = cavs.length;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      const availW = Math.max(Lb - 2 * WALL_IN, 1) || Lb;
      const availH = Math.max(Wb - 2 * WALL_IN, 1) || Wb;

      const cellW = availW / cols;
      const cellH = availH / rows;

      return cavs.map((c, idx) => {
        if (!c || (!isBad((c as any).x) && !isBad((c as any).y))) return c;

        const r = Math.floor(idx / cols);
        const col = idx % cols;

        const xIn = WALL_IN + col * cellW + cellW / 2;
        const yIn = WALL_IN + r * cellH + cellH / 2;

        const xNorm = Lb > 0 ? xIn / Lb : 0.1;
        const yNorm = Wb > 0 ? yIn / Wb : 0.1;

        return { ...(c as any), x: xNorm, y: yNorm };
      });
    };

    // Clone only if we actually repair something.
    let changed = false;

    let nextStack: any[] | undefined = undefined;
    if (Array.isArray((layout as any).stack)) {
      const stack = (layout as any).stack as any[];
      nextStack = stack.map((layer) => {
        if (!layer || typeof layer !== "object") return layer;
        const cavs = repairArray((layer as any).cavities);
        if (cavs === (layer as any).cavities) return layer;
        changed = true;
        return { ...(layer as any), cavities: cavs };
      });
    }

    const nextCavs = repairArray((layout as any).cavities);
    if (nextCavs !== (layout as any).cavities) changed = true;

    if (!changed) return layout;

    return {
      ...(layout as any),
      ...(nextStack ? { stack: nextStack } : null),
      cavities: nextCavs as any,
    } as any;
  } catch {
    return layout;
  }
}



// NOTE (shop convention): foam OD is typically undersized for box/mailer fit.
// This is a *note only* (no geometry is changed here).
const FOAM_FIT_UNDERSIZE_IN = 0.125;

/* Simple "LxWxH" parser */
function parseDimsTriple(
  raw: string | undefined | null,
): { L: number; W: number; H: number } | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/,
  );
  if (!m) return null;
  const L = Number(m[1]) || 0;
  const W = Number(m[2]) || 0;
  const H = Number(m[3]) || 0;
  if (!L || !W || !H) return null;
  return { L, W, H };
}

/* "LxW" or "LxWxD" parser (depth default 1")
   PLUS: circle support:
   - Ø2.5x1
   - @2.5x1
   - 2.5 dia x 1
   - 2.5 diameter x 1
*/
function parseCavityDims(raw: string): {
  L: number;
  W: number;
  D: number;
  shape?: "rect" | "circle";
} | null {
  const t = raw
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const num = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;

  // 1) Prefix mark: Ø2.5x1 or @2.5x1 (also accept dia/diam/diameter)
const circlePrefixRe = new RegExp(
  String.raw`(?:` +
    // Symbols/prefixes: Ø, ø, @, "dia", "diam", "diameter"
    String.raw`(?:[Øø@]|dia(?:m(?:eter)?)?)` +
    String.raw`)\s*` +
    // Diameter
    String.raw`(${num})\s*"?\s*` +
    // Separator: x, ×, by
    String.raw`(?:[x×]|by)\s*` +
    // Depth
    String.raw`(${num})\s*"?`,
  "iu"
);


  // 2) Infix word: 2.5 dia x 1 OR 2.5 diameter x 1 (x/by optional)
  const circleWordRe = new RegExp(
    String.raw`(${num})\s*(?:dia|diameter)\s*(?:[x×]|by)?\s*(${num})`,
  );

  let m = t.match(circlePrefixRe);
  if (!m) m = t.match(circleWordRe);

  if (m) {
    const dia = Number(m[1]) || 0;
    const depth = Number(m[2]) || 0;
    if (!dia || !depth) return null;

    return { L: dia, W: dia, D: depth, shape: "circle" };
  }

  // ---- Rect forms (existing behavior) ----
  const tripleRe = new RegExp(
    String.raw`(${num})\s*[x×]\s*(${num})\s*[x×]\s*(${num})`,
  );
  const doubleRe = new RegExp(String.raw`(${num})\s*[x×]\s*(${num})`);

  m = t.match(tripleRe);
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    const D = Number(m[3]) || 0;
    if (!L || !W || !D) return null;
    return { L, W, D, shape: "rect" };
  }

  m = t.match(doubleRe);
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    if (!L || !W) return null;
    return { L, W, D: 1, shape: "rect" };
  }

  return null;
}

function snapInches(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

function snapCenterInches(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / CENTER_SNAP_IN) * CENTER_SNAP_IN;
}

type LoopPoint = { x: number; y: number };

function computeLoopBbox(points: LoopPoint[] | null | undefined): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return any ? { minX, maxX, minY, maxY } : null;
}

function computeLoopCentroid(points: LoopPoint[] | null | undefined): { x: number; y: number } | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sumX += x;
    sumY += y;
    count += 1;
  }

  if (!count) return null;
  return { x: sumX / count, y: sumY / count };
}


export default function LayoutPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // Optional sales credit carried into the editor URL.
  // Accept both sales_rep_slug (preferred) and legacy aliases (sales/rep).
  const initialSalesRepSlugParam = ((
    (searchParams as any)?.sales_rep_slug ??
    (searchParams as any)?.sales ??
    (searchParams as any)?.rep ??
    ""
  ) as string | string[] | undefined);

  const [salesRepSlugFromUrl, setSalesRepSlugFromUrl] = React.useState<string>(
    Array.isArray(initialSalesRepSlugParam)
      ? (initialSalesRepSlugParam[0] || "").trim()
      : (initialSalesRepSlugParam || "").trim(),
  );

  const initialQuoteNoParam = (searchParams?.quote_no ??
    searchParams?.quote ??
    "") as string | string[] | undefined;
  const [quoteNoFromUrl, setQuoteNoFromUrl] = React.useState<string>(
    Array.isArray(initialQuoteNoParam)
      ? initialQuoteNoParam[0]?.trim() || ""
      : initialQuoteNoParam?.trim() || "",
  );

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const q =
        url.searchParams.get("quote_no") || url.searchParams.get("quote") || "";
      if (q && q !== quoteNoFromUrl) setQuoteNoFromUrl(q);
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const s =
        url.searchParams.get("sales_rep_slug") ||
        url.searchParams.get("sales") ||
        url.searchParams.get("rep") ||
        "";
      const sTrim = (s || "").trim();
      if (sTrim !== salesRepSlugFromUrl) setSalesRepSlugFromUrl(sTrim);
    } catch {}
  }, []);

  /* ---------- Other URL params (dims, cavities) ---------- */

  const hasDimsFromUrl =
    typeof searchParams?.dims !== "undefined" ||
    typeof searchParams?.block !== "undefined";

  const hasCavitiesFromUrl =
    typeof searchParams?.cavities !== "undefined" ||
    typeof searchParams?.cavity !== "undefined";

  // Server-side / initial guesses from Next searchParams
  const serverBlockStr = normalizeDimsParam(
    (searchParams?.dims ?? searchParams?.block) as
      | string
      | string[]
      | undefined,
  );

  const serverCavityStr = normalizeCavitiesParam(
    (searchParams?.cavities ?? searchParams?.cavity) as
      | string
      | string[]
      | undefined,
  );

  const hasExplicitCavities = hasCavitiesFromUrl && serverCavityStr.length > 0;

  const hasRealQuoteNo = !!quoteNoFromUrl && quoteNoFromUrl.trim().length > 0;

  const quoteNo = hasRealQuoteNo ? quoteNoFromUrl.trim() : "Q-AI-EXAMPLE";
    const [materialIdFromUrl, setMaterialIdFromUrl] =
    React.useState<number | null>(() => {
      const candidates = [
        searchParams?.material_id,
        (searchParams as any)?.materialId,
        (searchParams as any)?.material_id,
        (searchParams as any)?.material,
        (searchParams as any)?.foam_material_id,
      ] as Array<string | string[] | undefined>;

      const raw = candidates.find((v) => typeof v !== "undefined");
      if (!raw) return null;

      const first = Array.isArray(raw) ? raw[0] : raw;
      const parsed = Number((first ?? "").toString().trim());
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    });

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
            const midRaw =
        url.searchParams.get("material_id") ||
        url.searchParams.get("materialId") ||
        url.searchParams.get("material") ||
        url.searchParams.get("foam_material_id");

      if (!midRaw) return;

      const parsed = Number(midRaw);

      if (!Number.isFinite(parsed) || parsed <= 0) return;
      setMaterialIdFromUrl((prev) => (prev === parsed ? prev : parsed));
    } catch {
      // ignore
    }
  }, []);

  /* ---------- Build initial layout (from DB if available) ---------- */

  const [initialLayout, setInitialLayout] = React.useState<LayoutModel | null>(
    null,
  );
  const [facesJson, setFacesJson] = React.useState<any | null>(null);
  const [seed, setSeed] = React.useState<LayoutModel | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(null);
  const [initialMaterialId, setInitialMaterialId] =
    React.useState<number | null>(null);
  const [seedVersion, setSeedVersion] = React.useState(0);

  // Holds foam label from form URL (e.g. foam=1.7# Black PE)
  // Passed into LayoutEditorHost so it can resolve → material ID after /api/materials loads
  const [initialMaterialLabel, setInitialMaterialLabel] =
    React.useState<string | null>(null);





  // customer initial values (prefill from quote header when available)
  const [initialCustomerName, setInitialCustomerName] =
    React.useState<string>("");
  const [initialCustomerEmail, setInitialCustomerEmail] =
    React.useState<string>("");
  const [initialCustomerCompany, setInitialCustomerCompany] =
    React.useState<string>("");
  const [initialCustomerPhone, setInitialCustomerPhone] =
    React.useState<string>("");

  const [loadingLayout, setLoadingLayout] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (!facesJson) return;
    const s = facesJsonToLayoutSeed(facesJson);
    
    // If forge detected chamfers, automatically enable cropCorners on all layers
    if (s.block?.cornerStyle === "chamfer" && s.block?.chamferIn && s.block.chamferIn > 0) {
      console.log("🔧 Auto-enabling cropCorners because forge detected chamfers");
      if (s.stack && Array.isArray(s.stack)) {
        s.stack = s.stack.map((layer: any) => ({
          ...layer,
          cropCorners: true,
        }));
      }
    }
    
    setSeed(s);
    setInitialLayout(s);
    setSeedVersion((v) => v + 1);
    setLoadingLayout(false);
  }, [facesJson]);

  /**
   * Fallback layout builder, driven by arbitrary dims/cavities strings.
   */
  const buildFallbackLayout = React.useCallback(
    (
      blockStr: string,
      cavityStr: string,
      layersInfo?: { thicknesses: number[]; labels: string[] } | null,
      perLayerCavityStrs?: string[] | null,
    ): LayoutModel => {
      // Block from dims=..., default 10x10x2 if missing.
      const parsedBlock = parseDimsTriple(blockStr) ?? {
        L: 10,
        W: 10,
        H: 2,
      };

      const block: any = {
        lengthIn: parsedBlock.L,
        widthIn: parsedBlock.W,
        thicknessIn: parsedBlock.H,
        // NEW: defaults (square) — we intentionally do NOT auto-chamfer on fallback
        // cornerStyle/chamferIn are left undefined unless user toggles.
      };

      // If layers are provided, block thickness becomes total stack thickness.
      if (
        layersInfo &&
        Array.isArray(layersInfo.thicknesses) &&
        layersInfo.thicknesses.length > 0
      ) {
        const sum = layersInfo.thicknesses.reduce(
          (acc, n) => acc + (Number(n) || 0),
          0,
        );
        if (Number.isFinite(sum) && sum > 0) {
          block.thicknessIn = sum;
        }
      }

      // Cavities from cavities=... string (can be "1x1x1;2x2x1" etc).
      const cavTokens = (cavityStr || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const cavities: LayoutModel["cavities"] = [];

      if (cavTokens.length > 0) {
        const parsedCavs = cavTokens
          .map((tok) => parseCavityDims(tok))
          .filter(Boolean) as {
          L: number;
          W: number;
          D: number;
          shape?: "rect" | "circle";
        }[];

        const count = parsedCavs.length;

        if (count > 0) {
          const cols = Math.ceil(Math.sqrt(count));
          const rows = Math.ceil(count / cols);

          const availW =
            Math.max(block.lengthIn - 2 * WALL_IN, 1) || block.lengthIn;
          const availH =
            Math.max(block.widthIn - 2 * WALL_IN, 1) || block.widthIn;

          const cellW = availW / cols;
          const cellH = availH / rows;

          parsedCavs.forEach((c, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            const rawX = WALL_IN + col * cellW + (cellW - c.L) / 2;
            const rawY = WALL_IN + row * cellH + (cellH - c.W) / 2;

            const clamp = (v: number, min: number, max: number) =>
              v < min ? min : v > max ? max : v;

            const minX = WALL_IN;
            const maxX = block.lengthIn - WALL_IN - c.L;
            const minY = WALL_IN;
            const maxY = block.widthIn - WALL_IN - c.W;

            const xIn = clamp(rawX, minX, Math.max(minX, maxX));
            const yIn = clamp(rawY, minY, Math.max(minY, maxY));

            const xNorm = block.lengthIn > 0 ? xIn / block.lengthIn : 0.1;
            const yNorm = block.widthIn > 0 ? yIn / block.widthIn : 0.1;

            const isCircle = (c as any).shape === "circle";

            cavities.push({
              id: `cav-${idx + 1}`,
              label: isCircle ? `Ø${c.L}×${c.D} in` : `${c.L}×${c.W}×${c.D} in`,
              shape: isCircle ? "circle" : "rect",
              cornerRadiusIn: 0,
              lengthIn: c.L,
              widthIn: c.W,
              depthIn: c.D,
              x: xNorm,
              y: yNorm,
            });
          });
        }
      }

      // If no layers, legacy single-layer return.
      if (
        !layersInfo ||
        !layersInfo.thicknesses ||
        layersInfo.thicknesses.length === 0
      ) {
        return { block, cavities } as any;
      }

      // Multi-layer: build stack and assign cavities.
      // If per-layer cavities exist, use them; otherwise assign the generic cavities to the middle layer.
      const n = layersInfo.thicknesses.length;
      const midIdx = Math.max(0, Math.min(n - 1, Math.floor((n - 1) / 2)));

      const stack = layersInfo.thicknesses.map((t, i) => {
        const id = `layer-${i + 1}`;
        const label =
          layersInfo.labels && layersInfo.labels[i]
            ? layersInfo.labels[i]
            : `Layer ${i + 1}`;

        let layerCavityStr = "";
        if (perLayerCavityStrs && perLayerCavityStrs[i]) {
          layerCavityStr = perLayerCavityStrs[i];
        }

        // Build cavities for this layer:
        // - If layer-specific cavities exist -> build them
        // - Else if we have generic cavities -> only assign them to the middle layer
        const cavStrToUse = layerCavityStr.trim()
          ? layerCavityStr
          : cavityStr && cavityStr.trim() && i === midIdx
          ? cavityStr
          : "";

        const layerLayout = cavStrToUse
          ? buildFallbackLayout(blockStr, cavStrToUse, null, null) // legacy builder recursion, no layers
          : { block, cavities: [] as LayoutModel["cavities"] };

        return {
          id,
          label,
          thicknessIn: snapInches(Number(t) || 0),
          cavities: layerLayout.cavities,
        };
      });

      // IMPORTANT: layout.cavities should reflect the active layer’s cavities initially.
      // Default active layer = first layer.
      return {
        block,
        cavities: stack[0]?.cavities ?? [],
        stack,
      } as any;
    },
    [],
  );

  React.useEffect(() => {
    let cancelled = false;


    async function load() {
      const materialIdOverride = materialIdFromUrl;
      setLoadingLayout(true);
      setFacesJson(null);
      setSeed(null);

      // Re-read dims/cavities/layers from the actual address bar (canonical seed read).
      let effectiveBlockStr = serverBlockStr;
      let effectiveCavityStr = serverCavityStr;

      // NEW: optional multi-layer info from URL (used by fallback builder)
      let layersInfo: { thicknesses: number[]; labels: string[] } | null = null;
      let perLayerCavityStrs: string[] | null = null;

      // NEW: customer seed from URL (form deep-links)
      let customerSeed: { name: string; email: string; company: string; phone: string } = {
        name: "",
        email: "",
        company: "",
        phone: "",
      };

      // NEW: keep URL seeds in *locals* to avoid stale React state overwriting them later
let qtySeedLocal: number | null = null;
let materialSeedLocal: number | null = null;
let materialLabelSeedLocal: string | null = null;
let notesSeedLocal: string = "";



      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);

                    // dims / block (canonical) + common aliases
          const dimsCandidates: string[] = [];
          const dimsA = url.searchParams.get("dims");
          const dimsB = url.searchParams.get("block");
          if (dimsA) dimsCandidates.push(dimsA);
          if (!dimsA && dimsB) dimsCandidates.push(dimsB);

          // Common "split fields" forms from parsers/forms:
          //   block_length_in=18&block_width_in=12&block_thickness_in=3
          //   length=18&width=12&thickness=3
          const lRaw =
            url.searchParams.get("block_length_in") ||
            url.searchParams.get("block_length") ||
            url.searchParams.get("length") ||
            "";
          const wRaw =
            url.searchParams.get("block_width_in") ||
            url.searchParams.get("block_width") ||
            url.searchParams.get("width") ||
            "";
          const tRaw =
            url.searchParams.get("block_thickness_in") ||
            url.searchParams.get("block_thickness") ||
            url.searchParams.get("thickness") ||
            "";

          const l = Number(lRaw);
          const w = Number(wRaw);
          const t = Number(tRaw);

          if (
            Number.isFinite(l) && l > 0 &&
            Number.isFinite(w) && w > 0 &&
            Number.isFinite(t) && t > 0
          ) {
            dimsCandidates.push(`${l}x${w}x${t}`);
          }


          // cavities / cavity (canonical)
          const cavityParts: string[] = [];
          const cavitiesParams = url.searchParams
            .getAll("cavities")
            .filter((v) => v);
          const cavityParams = url.searchParams.getAll("cavity").filter((v) => v);

          cavityParts.push(...cavitiesParams, ...cavityParams);

          if (dimsCandidates.length > 0) {
            effectiveBlockStr = normalizeDimsParam(dimsCandidates[0]);
          }

          if (cavityParts.length > 0) {
            effectiveCavityStr = normalizeCavitiesParam(cavityParts);
          }
          // customer prefill (canonical)
          customerSeed = readCustomerFromUrl(url);

          // notes seed from URL (form → editor)
notesSeedLocal = readNotesFromUrl(url);



          // qty + material seed from URL (form deep-links)
          qtySeedLocal = readQtyFromUrl(url);

          const materialSeedRaw =
  url.searchParams.get("material_id") ||
  url.searchParams.get("materialId") ||
  url.searchParams.get("material") ||
  url.searchParams.get("foam_material_id");

// numeric ID path (email seeding)
const materialSeedNum = materialSeedRaw ? Number(materialSeedRaw) : NaN;
materialSeedLocal =
  Number.isFinite(materialSeedNum) && materialSeedNum > 0
    ? materialSeedNum
    : null;

// string label path (form seeding)
const foamLabel =
  url.searchParams.get("foam") ||
  url.searchParams.get("foam_label");

materialLabelSeedLocal = foamLabel ? foamLabel.trim() : null;


          if (qtySeedLocal != null) {
            setInitialQty(qtySeedLocal);
          }

        if (materialSeedLocal != null) {
  // keep existing state if already set; otherwise seed it
  setMaterialIdFromUrl((prev) => (prev == null ? materialSeedLocal : prev));
}

// stash foam label for post-material-load resolution
if (materialLabelSeedLocal) {
  setInitialMaterialLabel(materialLabelSeedLocal);
}






          // layers + per-layer cavities (canonical) — ONLY ONCE
          // --- Layer seeding (canonical / “conical”): prefer modern params, fall back to legacy ---
          const layersRaw =
            url.searchParams.get("layers") ??
            (url.searchParams.getAll("layer").length > 0
              ? url.searchParams.getAll("layer").join(",")
              : null);

          // Legacy params currently produced by some links:
          //  - layer_thicknesses=1,4,1
          //  - layer_count=3
          //  - layer_cavity_layer_index=2   (1-based)
          const legacyThicknessesAll = url.searchParams
            .getAll("layer_thicknesses")
            .map((s) => (s ?? "").trim())
            .filter(Boolean);

          // Legacy single value fallback (older links)
          const legacyThicknessesRaw =
            legacyThicknessesAll.length > 0
              ? legacyThicknessesAll
              : url.searchParams.get("layer_thickness") ?? null;

          // 1) Parse layers from modern params first, then legacy thickness list
          layersInfo = layersRaw
            ? parseLayersParam(layersRaw)
            : legacyThicknessesRaw
            ? parseLayersParam(legacyThicknessesRaw)
            : null;

          // 2) Build per-layer cavity strings
          if (layersInfo && layersInfo.thicknesses.length > 0) {
            const n = layersInfo.thicknesses.length;

            // Prefer explicit per-layer cavities in URL (cavities_l1 / cavity_l1, etc.)
            perLayerCavityStrs = layersInfo.thicknesses.map((_, i) =>
              readLayerCavitiesFromUrl(url, i + 1),
            );

            // If none were provided, fall back to assigning the generic cavities string
            // to the requested layer index (legacy behavior), else to middle layer.
            const anyLayerHasCavs = perLayerCavityStrs.some(
              (s) => (s || "").trim().length > 0,
            );

            if (!anyLayerHasCavs) {
              const legacyIdxRaw = url.searchParams.get("layer_cavity_layer_index");
              const legacyIdx = legacyIdxRaw ? Number(legacyIdxRaw) : NaN;

              const fallbackTarget =
                Number.isFinite(legacyIdx) && legacyIdx >= 1 && legacyIdx <= n
                  ? legacyIdx - 1
                  : Math.max(0, Math.min(n - 1, Math.floor((n - 1) / 2)));

              if ((effectiveCavityStr || "").trim().length > 0) {
                perLayerCavityStrs[fallbackTarget] = effectiveCavityStr;
              }
            }
          }
        }
      } catch {
        // if anything goes wrong, we fall back to serverBlockStr/serverCavityStr
      }

      try {
        // If we don't have a real quote number, just use fallback layout
               if (!hasRealQuoteNo) {
          const fallback = buildFallbackLayout(
            effectiveBlockStr,
            effectiveCavityStr,
            layersInfo,
            perLayerCavityStrs,
          );
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes(notesSeedLocal || "");

           setInitialQty(qtySeedLocal ?? null);
setInitialMaterialId(materialIdOverride ?? materialSeedLocal ?? materialIdFromUrl ?? null);


            // NEW: allow form deep-links to prefill customer fields
            setInitialCustomerName(customerSeed.name || "");
            setInitialCustomerEmail(customerSeed.email || "");
            setInitialCustomerCompany(customerSeed.company || "");
            setInitialCustomerPhone(customerSeed.phone || "");

            setLoadingLayout(false);
          }
          return;
        }


        // Try to fetch the latest layout package via /api/quote/print
        const res = await fetch(
          "/api/quote/print?quote_no=" + encodeURIComponent(quoteNoFromUrl.trim()),
          { cache: "no-store" },
        );

        if (!res.ok) {
          const fallback = buildFallbackLayout(
            effectiveBlockStr,
            effectiveCavityStr,
            layersInfo,
            perLayerCavityStrs,
          );
          if (!cancelled) {
            setInitialLayout(fallback);
            setInitialNotes(notesSeedLocal || "");

            setInitialQty(qtySeedLocal ?? null);
setInitialMaterialId(materialIdOverride ?? materialSeedLocal ?? materialIdFromUrl ?? null);

            // fallback to URL seed (form deep-link) instead of blanking
            setInitialCustomerName(customerSeed.name || "");
            setInitialCustomerEmail(customerSeed.email || "");
            setInitialCustomerCompany(customerSeed.company || "");
            setInitialCustomerPhone(customerSeed.phone || "");
            setLoadingLayout(false);
          }
          return;
        }

        const json = await res.json();

        // Pull qty + material from primary line item (if present)
        let qtyFromItems: number | null = null;
        let materialIdFromItems: number | null = null;
        if (Array.isArray(json.items) && json.items.length > 0) {
          const first = json.items[0];
          const rawQty = Number(first?.qty);
          if (Number.isFinite(rawQty) && rawQty > 0) {
            qtyFromItems = rawQty;
          }
          const mid = Number(first?.material_id);
          if (Number.isFinite(mid) && mid > 0) {
            materialIdFromItems = mid;
          }
        }

        // pull customer info from quote header when present
             if (json && json.quote && typeof json.quote === "object") {
          const qh = json.quote as {
            customer_name?: string;
            email?: string | null;
            phone?: string | null;
          };

          const dbName = (qh.customer_name ?? "").toString().trim();
          const dbEmail = (qh.email ?? "").toString().trim();
          const dbPhone = (qh.phone ?? "").toString().trim();

          if (!cancelled) {
            // Prefer DB; fall back to URL seed if DB is blank
            setInitialCustomerName(dbName || customerSeed.name || "");
            setInitialCustomerEmail(dbEmail || customerSeed.email || "");

            // Company isn’t stored on quotes table yet; allow URL seed to fill it
            setInitialCustomerCompany(customerSeed.company || "");

            setInitialCustomerPhone(dbPhone || customerSeed.phone || "");
          }
        } else if (!cancelled) {
          // No header → fall back to URL seed (form deep-link)
          setInitialCustomerName(customerSeed.name || "");
          setInitialCustomerEmail(customerSeed.email || "");
          setInitialCustomerCompany(customerSeed.company || "");
          setInitialCustomerPhone(customerSeed.phone || "");
        }


        // Prefer DB layout when it contains a real multi-layer stack,
        // even if URL dims/cavities are present (those are often legacy links).
        const dbLayout = json?.layoutPkg?.layout_json as LayoutModel | undefined;
        const dbHasStack =
          !!dbLayout &&
          Array.isArray((dbLayout as any).stack) &&
          (dbLayout as any).stack.length > 0;

        const forceForgeSeed =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("force_forge_seed") === "1";

        if (json && json.ok && (forceForgeSeed || !dbLayout || !dbHasStack)) {
          try {
            const latestRes = await fetch(
              `/api/quote-attachments/latest?quote_no=${encodeURIComponent(
                quoteNoFromUrl.trim(),
              )}&filename=${encodeURIComponent("forge_faces.json")}`,
              { cache: "no-store" },
            );

            const latestJson = await latestRes.json().catch(() => null);
            if (!latestRes.ok) {
              if (!cancelled) {
                setLoadingLayout(false);
                setUploadError(`Forge seed: latest lookup failed: ${latestRes.status}`);
              }
              return;
            }

            const attachmentId = Number(latestJson?.attachment?.id);
            if (Number.isFinite(attachmentId) && attachmentId > 0) {
              const facesDownload = await fetch(
                `/api/quote-attachments/${attachmentId}?t=${Date.now()}`,
                { cache: "no-store" },
              );

              if (!facesDownload.ok) {
                if (!cancelled) {
                  setLoadingLayout(false);
                  setUploadError(`Forge seed: download failed: ${facesDownload.status}`);
                }
                return;
              }

              const facesText = await facesDownload.text();
              let facesJson: any = null;
              try {
                facesJson = JSON.parse(facesText);
              } catch (e) {
                if (!cancelled) {
                  setLoadingLayout(false);
                  setUploadError(`Forge seed: JSON parse failed: ${String(e)}`);
                }
                return;
              }

              if (!cancelled) {
                setFacesJson(facesJson);
                setInitialNotes(notesSeedLocal || "");

                setInitialQty(qtyFromItems ?? qtySeedLocal ?? null);
                setInitialMaterialId(
                  materialIdOverride ??
                    materialIdFromItems ??
                    materialSeedLocal ??
                    materialIdFromUrl ??
                    null,
                );

                if (forceForgeSeed) {
                  try {
                    const u = new URL(window.location.href);
                    u.searchParams.delete("force_forge_seed");
                    window.history.replaceState({}, "", u.toString());
                  } catch {}
                }
              }
              return;
            }
          } catch (e) {
            console.warn("Forge faces seed failed; falling back:", e);
          }
        }

        if (json && json.ok && dbLayout && dbHasStack) {
          const notesFromDb = (json.layoutPkg.notes as string | null) ?? "";

          // IMPORTANT:
          // If the URL explicitly provides layer thicknesses (email deep-link),
          // prefer those values over any DB-saved stack thicknesses.
          // This prevents a subtle clobber where a DB layout stack may carry
          // missing/legacy thickness values (often defaulting to 1") even though
          // the backend-generated URL/facts are correct.
          let mergedLayout: LayoutModel = dbLayout;
          if (
            layersInfo &&
            Array.isArray(layersInfo.thicknesses) &&
            layersInfo.thicknesses.length > 0
          ) {
            const stack = (dbLayout as any).stack as any[];
            if (Array.isArray(stack) && stack.length > 0) {
              const urlTs = layersInfo.thicknesses;
              const sameLen = urlTs.length === stack.length;
              const anyMismatch = stack.some((l, i) => {
                const dbT = Number((l as any)?.thicknessIn);
                const urlT = Number(urlTs[i]);
                if (!Number.isFinite(urlT) || urlT <= 0) return false;
                // Treat missing/invalid DB thickness, or an obvious mismatch, as needing override.
                return (
                  !Number.isFinite(dbT) ||
                  dbT <= 0 ||
                  Math.abs(dbT - urlT) > 1e-6
                );
              });

              if (sameLen && anyMismatch) {
                const nextStack = stack.map((l, i) => ({
                  ...l,
                  thicknessIn: snapInches(Number(urlTs[i]) || 0),
                }));

                // Keep block length/width from DB, but ensure total thickness matches URL sum.
                const sum = urlTs.reduce((acc, n) => acc + (Number(n) || 0), 0);
                const nextBlock = {
                  ...(dbLayout as any).block,
                  thicknessIn:
                    Number.isFinite(sum) && sum > 0
                      ? snapInches(sum)
                      : (dbLayout as any).block?.thicknessIn,
                };

                mergedLayout = {
                  ...(dbLayout as any),
                  block: nextBlock,
                  stack: nextStack,
                  // Ensure cavities reflect the active layer (layer 1) on first open.
                  cavities: Array.isArray(nextStack[0]?.cavities)
                    ? nextStack[0].cavities
                    : (dbLayout as any).cavities,
                } as any;
              }
            }
          }

          if (!cancelled) {
            setInitialLayout(repairNullCavityXY(mergedLayout));
            setInitialNotes(notesSeedLocal || notesFromDb || "");

                        // Prefer DB items; fall back to URL seeds (locals) to avoid stale React state.
            setInitialQty(qtyFromItems ?? qtySeedLocal ?? null);

            // Prefer explicit override; then DB item; then URL seed local; then state (last resort)
            setInitialMaterialId(
              materialIdOverride ??
                materialIdFromItems ??
                materialSeedLocal ??
                materialIdFromUrl ??
                null,
            );

            setLoadingLayout(false);
          }
          return;
        }

        // Otherwise: Only use DB layout geometry when NO URL dims/cavities are present.
        if (
          json &&
          json.ok &&
          json.layoutPkg &&
          json.layoutPkg.layout_json &&
          !hasExplicitCavities &&
          !hasDimsFromUrl &&
          !hasCavitiesFromUrl
        ) {
          const layoutFromDb = json.layoutPkg.layout_json as LayoutModel;
          const notesFromDb = (json.layoutPkg.notes as string | null) ?? "";

          if (!cancelled) {
            setInitialLayout(layoutFromDb);
            setInitialNotes(notesFromDb);
            // Qty/material: prefer DB items; fall back to URL-seeded state if DB is missing
            setInitialQty(qtyFromItems ?? qtySeedLocal ?? null);
            setInitialMaterialId(
              materialIdOverride ??
                materialIdFromItems ??
                materialSeedLocal ??
                materialIdFromUrl ??
                null,
            );
            setLoadingLayout(false);
          }
          return;
        }

        // Otherwise, use layout from URL (dims/cavities) and keep qty/material.
        const fallback = buildFallbackLayout(
          effectiveBlockStr,
          effectiveCavityStr,
          layersInfo,
          perLayerCavityStrs,
        );
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes(notesSeedLocal || "");


          // Prefer DB items; else URL seeds (locals)
          setInitialQty(qtyFromItems ?? qtySeedLocal ?? null);

          setInitialMaterialId(
            materialIdOverride ??
              materialIdFromItems ??
              materialSeedLocal ??
              materialIdFromUrl ??
              null,
          );

          setLoadingLayout(false);
        }
      } catch (err) {
        console.error("Error loading layout for /quote/layout:", err);
        const fallback = buildFallbackLayout(
          effectiveBlockStr,
          effectiveCavityStr,
          layersInfo,
          perLayerCavityStrs,
        );
        if (!cancelled) {
          setInitialLayout(fallback);
          setInitialNotes(notesSeedLocal || "");

          setInitialQty(null);
          setInitialMaterialId(materialIdOverride ?? null);
                   setInitialCustomerName(customerSeed.name || "");
          setInitialCustomerEmail(customerSeed.email || "");
          setInitialCustomerCompany(customerSeed.company || "");
          setInitialCustomerPhone(customerSeed.phone || "");

          setLoadingLayout(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [
    hasRealQuoteNo,
    quoteNoFromUrl,
    buildFallbackLayout,
    hasExplicitCavities,
    hasDimsFromUrl,
    hasCavitiesFromUrl,
    serverBlockStr,
    serverCavityStr,
    materialIdFromUrl,
    setUploadError,
  ]);

  if (loadingLayout || !initialLayout) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),transparent_60%),radial-gradient(circle_at_bottom,_rgba(37,99,235,0.12),transparent_60%)]">
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.9)]">
          Loading layout preview&hellip;
        </div>
      </main>
    );
  }

  return (
      <LayoutEditorHost
        key={`seed-${seedVersion}`}
        quoteNo={quoteNo}
        hasRealQuoteNo={hasRealQuoteNo}
        initialLayout={initialLayout}
        initialNotes={initialNotes}
        initialQty={initialQty}
        initialMaterialId={initialMaterialId}
        initialMaterialLabel={initialMaterialLabel}
        initialCustomerName={initialCustomerName}
        initialCustomerEmail={initialCustomerEmail}
        initialCustomerCompany={initialCustomerCompany}
        initialCustomerPhone={initialCustomerPhone}
        uploadError={uploadError}
        setUploadError={setUploadError}
        setFacesJson={setFacesJson}
      />

  );
}

const CAVITY_COLORS = [
  "#38bdf8",
  "#a855f7",
  "#f97316",
  "#22c55e",
  "#eab308",
  "#ec4899",
];

/* ---------- Layout editor host (main body) ---------- */

function LayoutEditorHost(props: {
  quoteNo: string;
  hasRealQuoteNo: boolean;
  initialLayout: LayoutModel;
  initialNotes: string;
  initialQty: number | null;
  initialMaterialId: number | null;
  initialMaterialLabel: string | null;
  initialCustomerName: string;
  initialCustomerEmail: string;
  initialCustomerCompany: string;
  initialCustomerPhone: string;
  uploadError: string | null;
  setUploadError: React.Dispatch<React.SetStateAction<string | null>>;
  setFacesJson: React.Dispatch<React.SetStateAction<any | null>>;
}) {
  const { initialLayout } = props;
  const [layoutModel, setLayoutModel] = React.useState<LayoutModel | null>(null);

  React.useEffect(() => {
    if (!initialLayout) return;
    setLayoutModel(initialLayout);
  }, [initialLayout]);

  if (!layoutModel) {
    return null;
  }

  return <LayoutEditorHostReady {...props} layoutModel={layoutModel} setFacesJson={props.setFacesJson} />;
}

function LayoutEditorHostReady(props: {
  quoteNo: string;
  hasRealQuoteNo: boolean;
  initialLayout: LayoutModel;
  initialNotes: string;
  initialQty: number | null;
  initialMaterialId: number | null;
  initialMaterialLabel: string | null;
  initialCustomerName: string;
  initialCustomerEmail: string;
  initialCustomerCompany: string;
  initialCustomerPhone: string;
  uploadError: string | null;
  setUploadError: React.Dispatch<React.SetStateAction<string | null>>;
  layoutModel: LayoutModel;
  setFacesJson: React.Dispatch<React.SetStateAction<any | null>>;
}) {
  const {
    quoteNo,
    hasRealQuoteNo,
    layoutModel,
    initialNotes,
    initialQty,
    initialMaterialId,
    initialCustomerName,
    initialCustomerEmail,
    initialCustomerCompany,
    initialCustomerPhone,
        initialMaterialLabel,
    uploadError,
    setUploadError,
    setFacesJson,

  } = props;

  const router = useRouter();
  
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploadStatus, setUploadStatus] = React.useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");


  const {
    layout,
    editorMode,
    setEditorMode,
    selectedIds,
    selectedId,
    activeLayerId,
    selectCavity,
    setActiveLayerId,
    setLayerCropCorners,
    setLayerRoundCorners,
    setLayerRoundRadiusIn,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
    addLayer,
    renameLayer,
    deleteLayer,
    importLayerFromSeed,
  } = useLayoutModel(layoutModel);


  const { block, cavities, stack } = layout as LayoutModel & {
    stack?: {
      id: string;
      label: string;
      cavities: any[];
      thicknessIn?: number;
    }[];
  };

  const guidedSteps = React.useMemo<GuidedStep[]>(
    () => [
      { id: "customer-info", label: "Customer info" },
      { id: "layers", label: "Layers" },
      { id: "layer-details", label: "Layer details" },
      { id: "cavity-palette", label: "Cavity palette" },
      { id: "cavity-editor", label: "Cavity editor" },
      { id: "foam-material", label: "Foam material" },
      { id: "box-suggester", label: "Box suggester" },
      { id: "notes", label: "Notes" },
      { id: "apply", label: "Apply to quote" },
    ],
    [],
  );
  const guided = useGuidedInput(guidedSteps);
  const guidedActiveId = guided.enabled ? guided.steps[guided.stepIndex]?.id : null;
  const guidedClass = (id: string) => {
    if (!guided.enabled) return "";
    if (guidedActiveId === id) {
      return "relative z-20 ring-2 ring-sky-400/80 shadow-[0_0_22px_rgba(56,189,248,0.35)]";
    }
    return "opacity-85";
  };
  const isLastGuidedStep = guided.stepIndex >= guided.steps.length - 1;
  const guidedStepLabel = guided.steps[guided.stepIndex]?.label ?? "";

  
  const blockThicknessIn = Number(block.thicknessIn) || 0;

  // Thickness source of truth:
  // - layout.stack[].thicknessIn
  // - fallback: block.thicknessIn only for legacy / single-layer layouts without thicknessIn seeded
  const [thicknessTick, setThicknessTick] = React.useState(0);

  const getLayerThickness = React.useCallback(
    (layerId: string): number => {
      const layer =
        stack && stack.length > 0
          ? stack.find((l) => l.id === layerId) ?? null
          : null;

      const raw = layer ? Number(layer.thicknessIn) : NaN;
      if (Number.isFinite(raw) && raw > 0) return raw;

      return blockThicknessIn;
    },
    [stack, blockThicknessIn, thicknessTick],
  );

  const setLayerThicknessIn = React.useCallback(
    (layerId: string, nextThicknessIn: number) => {
      if (!stack || stack.length === 0) return;

      const layer = stack.find((l) => l.id === layerId);
      if (!layer) return;

      const snapped = snapInches(nextThicknessIn);
      if (!Number.isFinite(snapped) || snapped <= 0) return;

      layer.thicknessIn = snapped;

      // Force a re-render so inputs + derived totals update immediately.
      setThicknessTick((t) => t + 1);

      // Legacy/single-layer fallback rule: keep block thickness in sync when only one layer exists.
      if (stack.length === 1) {
        updateBlockDims({ thicknessIn: snapped });
      }
    },
    [stack, updateBlockDims],
  );

  // Seed missing per-layer thickness from block thickness (one-time / as stack changes).
  React.useEffect(() => {
    if (!stack || stack.length === 0) return;

    let changed = false;

    for (const layer of stack) {
      const raw = Number(layer.thicknessIn);
      if (!Number.isFinite(raw) || raw <= 0) {
        // fallback seed
        layer.thicknessIn = blockThicknessIn;
        changed = true;
      }
    }

    if (changed) {
      setThicknessTick((t) => t + 1);
    }
  }, [stack, blockThicknessIn]);

  const activeLayer =
    stack && stack.length > 0
      ? stack.find((layer) => layer.id === activeLayerId) ?? stack[0]
      : null;

  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  // Advanced mode removes spacing restrictions (no wall offset, no min gap enforcement)
  const wallIn = editorMode === "advanced" ? 0 : WALL_IN;
  const secondSelectedCavity =
    selectedIds.length >= 2
      ? cavities.find((c) => c.id === selectedIds[1]) || null
      : null;

  // Multi-layer: derive layers view if stack exists
  const layers = layout.stack && layout.stack.length > 0 ? layout.stack : null;

  const effectiveActiveLayerId =
    layers && layers.length > 0 ? activeLayerId ?? layers[0].id : null;

  const layerDisplayLabel = (index: number) => `Layer ${index + 1}`;
  const activeLayerIndex =
    layers && layers.length > 0
      ? layers.findIndex((layer) => layer.id === effectiveActiveLayerId)
      : -1;
  const activeLayerDisplayLabel =
    layers && layers.length > 0
      ? layerDisplayLabel(activeLayerIndex >= 0 ? activeLayerIndex : 0)
      : null;

  // Total stack thickness used for box/carton suggestions.
  // Rule:
  // - No stack => use block thickness (legacy).
  // - 1+ layers => sum of stack[].thicknessIn (fallback per-layer to block thickness if missing).
  let totalStackThicknessIn = blockThicknessIn;

  if (stack && stack.length >= 1) {
    const sum = stack.reduce((acc, layer) => {
      const raw = Number(layer.thicknessIn);
      const t = Number.isFinite(raw) && raw > 0 ? raw : blockThicknessIn;
      return acc + t;
    }, 0);

    if (sum > 0) totalStackThicknessIn = sum;
  }

  // Ensure the hook actually has an active layer when a stack exists
  React.useEffect(() => {
    if (layers && layers.length > 0 && !activeLayerId) {
      setActiveLayerId(layers[0].id);
    }
  }, [layers, activeLayerId, setActiveLayerId]);

  // Clear selection when switching layers so we don't edit a cavity from a different layer
  const layerCount = layers?.length ?? 0;
  React.useEffect(() => {
    if (!layers || layerCount === 0) return;
    selectCavity(null);
  }, [effectiveActiveLayerId, layerCount, selectCavity]);

  // When a new cavity is added, try to drop it into "dead space"
  const prevCavityCountRef = React.useRef<number>(cavities.length);
  const allowAutoPlaceRef = React.useRef(false);
  const didHydrateRef = React.useRef(false);


  // NEW: layer-switch guard.
  // Switching layers can change cavities.length (e.g., 0 -> 3) which looks like
  // "a cavity was added" and this effect will reposition the last cavity.
  // We bail out on layer change and only sync the baseline count.
 const prevLayerIdRef = React.useRef<string | null>(null);



  React.useEffect(() => {
// 🔒 Hydration guard: on first load, sync baseline and exit.
// Prevents rehydrated cavities from being treated as "new".
if (!didHydrateRef.current) {
  didHydrateRef.current = true;
  prevCavityCountRef.current = cavities.length;
  return;
}
    // If we changed layers, do NOT run auto-placement.
    // Just sync our baseline and exit.
    // Ignore initial null → first real layer assignment
if (
  prevLayerIdRef.current != null &&
  prevLayerIdRef.current !== effectiveActiveLayerId
) {
  prevLayerIdRef.current = effectiveActiveLayerId;
  prevCavityCountRef.current = cavities.length;
  return;
}

// First real layer capture
if (prevLayerIdRef.current == null && effectiveActiveLayerId != null) {
  prevLayerIdRef.current = effectiveActiveLayerId;
}


    const prevCount = prevCavityCountRef.current;

    if (
  allowAutoPlaceRef.current &&
  cavities.length > prevCount &&
  block.lengthIn &&
  block.widthIn &&

      Number.isFinite(block.lengthIn) &&
      Number.isFinite(block.widthIn)
    ) {
      const newCavity = cavities[cavities.length - 1];
      if (newCavity) {
        const existing = cavities.slice(0, -1);

        const cavLen = Number(newCavity.lengthIn) || 1;
        const cavWid = Number(newCavity.widthIn) || 1;

        const usableLen = Math.max(block.lengthIn - 2 * wallIn, cavLen);
        const usableWid = Math.max(block.widthIn - 2 * wallIn, cavWid);

        const isOverlapping = (xIn: number, yIn: number) => {
          return existing.some((c) => {
            const cxIn = (Number(c.x) || 0) * block.lengthIn;
            const cyIn = (Number(c.y) || 0) * block.widthIn;
            const cLen = Number(c.lengthIn) || 0;
            const cWid = Number(c.widthIn) || 0;

            // Simple AABB overlap check
            return !(
              xIn + cavLen <= cxIn ||
              cxIn + cLen <= xIn ||
              yIn + cavWid <= cyIn ||
              cyIn + cWid <= yIn
            );
          });
        };

        let chosenXIn: number | null = null;
        let chosenYIn: number | null = null;

        const cols = 3;
        const rows = 3;
        const cellW = usableLen / cols;
        const cellH = usableWid / rows;

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const centerXIn = wallIn + cellW * (col + 0.5);
            const centerYIn = wallIn + cellH * (row + 0.5);

            let xIn = centerXIn - cavLen / 2;
            let yIn = centerYIn - cavWid / 2;

            const minXIn = wallIn;
            const maxXIn = block.lengthIn - wallIn - cavLen;
            const minYIn = wallIn;
            const maxYIn = block.widthIn - wallIn - cavWid;

            const clamp = (v: number, min: number, max: number) =>
              v < min ? min : v > max ? max : v;

            xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
            yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

            if (!isOverlapping(xIn, yIn)) {
              chosenXIn = xIn;
              chosenYIn = yIn;
              break;
            }
          }
          if (chosenXIn != null) break;
        }

        // Fallback: center placement inside walls
        if (chosenXIn == null || chosenYIn == null) {
          let xIn = (block.lengthIn - cavLen) / 2;
          let yIn = (block.widthIn - cavWid) / 2;

          const minXIn = wallIn;
          const maxXIn = block.lengthIn - wallIn - cavLen;
          const minYIn = wallIn;
          const maxYIn = block.widthIn - wallIn - cavWid;

          const clamp = (v: number, min: number, max: number) =>
            v < min ? min : v > max ? max : v;

          xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
          yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

          chosenXIn = xIn;
          chosenYIn = yIn;
        }

        if (
          chosenXIn != null &&
          chosenYIn != null &&
          block.lengthIn > 0 &&
          block.widthIn > 0
        ) {
          const xNorm = chosenXIn / block.lengthIn;
          const yNorm = chosenYIn / block.widthIn;
          updateCavityPosition(newCavity.id, xNorm, yNorm);
        }
      }
    }

    // Always update baseline at end
    allowAutoPlaceRef.current = false;
    prevCavityCountRef.current = cavities.length;
  }, [
    cavities,
    block.lengthIn,
    block.widthIn,
    effectiveActiveLayerId,
    updateCavityPosition,
  ]);

  // Handle edits to the active layer's thickness
  const handleActiveLayerThicknessChange = (value: string) => {
    if (!activeLayer) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setLayerThicknessIn(activeLayer.id, num);
  };

  const [zoom, setZoom] = React.useState(1);

    // --- Block dimension inputs (type freely, commit on Enter/Blur; snap to 0.125) ---
  const [blockInputs, setBlockInputs] = React.useState<{ length: string; width: string }>(() => ({
    length: block.lengthIn != null ? String(block.lengthIn) : "",
    width: block.widthIn != null ? String(block.widthIn) : "",
  }));

  // Keep the input boxes in sync when block dims change from elsewhere (buttons/arrows/apply)
  React.useEffect(() => {
    setBlockInputs({
      length: block.lengthIn != null ? String(block.lengthIn) : "",
      width: block.widthIn != null ? String(block.widthIn) : "",
    });
  }, [block.lengthIn, block.widthIn]);

  const commitBlockDimField = React.useCallback(
    (field: "length" | "width") => {
      const raw = (blockInputs[field] ?? "").trim();

      // If user leaves it blank (or invalid), revert to current model value
      const revert = () => {
        setBlockInputs({
          length: block.lengthIn != null ? String(block.lengthIn) : "",
          width: block.widthIn != null ? String(block.widthIn) : "",
        });
      };

      if (!raw) {
        revert();
        return;
      }

      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        revert();
        return;
      }

      const snapped = snapInches(parsed); // SNAP_IN = 0.125
      if (!Number.isFinite(snapped) || snapped <= 0) {
        revert();
        return;
      }

      if (field === "length") updateBlockDims({ lengthIn: snapped });
      else updateBlockDims({ widthIn: snapped });

      setBlockInputs((prev) => ({ ...prev, [field]: String(snapped) }));
    },
    [blockInputs, block.lengthIn, block.widthIn, updateBlockDims],
  );


  // Crop corners is PER-LAYER (active layer).
  // Each layer can independently enable the 1" crop on export.
  const croppedCorners = !!(activeLayer as any)?.cropCorners;
  const roundCorners = !!(activeLayer as any)?.roundCorners;
  const roundRadiusInRaw = Number((activeLayer as any)?.roundRadiusIn);
  const roundRadiusIn =
    Number.isFinite(roundRadiusInRaw) && roundRadiusInRaw > 0
      ? roundRadiusInRaw
      : DEFAULT_ROUND_RADIUS_IN;

  const [roundRadiusDrafts, setRoundRadiusDrafts] = React.useState<Record<string, string>>({});

  const commitRoundRadius = React.useCallback(
    (layerId: string, fallback: number, raw?: string) => {
      const source = raw ?? roundRadiusDrafts[layerId];
      const parsed = Number.parseFloat((source ?? "").toString().trim());
      const maxRadius = Math.max(
        0,
        Math.min(block.lengthIn / 2 - 1e-6, block.widthIn / 2 - 1e-6),
      );

      if (!Number.isFinite(parsed) || parsed < 0) {
        setRoundRadiusDrafts((prev) => ({
          ...prev,
          [layerId]: String(fallback),
        }));
        return;
      }

      const next = Math.min(parsed, maxRadius);
      setLayerRoundRadiusIn(layerId, next);
      setRoundRadiusDrafts((prev) => ({
        ...prev,
        [layerId]: String(next),
      }));
    },
    [block.lengthIn, block.widthIn, roundRadiusDrafts, setLayerRoundRadiusIn],
  );

  const [notes, setNotes] = React.useState(initialNotes || "");
  const [applyStatus, setApplyStatus] = React.useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [qty, setQty] = React.useState<number | "">(
    initialQty != null ? initialQty : "",
  );

    // Keep qty in sync when initialQty arrives asynchronously.
  // Only seed qty if the user hasn't typed/changed it yet (qty is still blank).
  React.useEffect(() => {
    if (initialQty == null) return;
    setQty((prev) => (prev === "" ? initialQty : prev));
  }, [initialQty]);


  // Customer info
  const [customerName, setCustomerName] = React.useState<string>(
    initialCustomerName || "",
  );
  const [customerEmail, setCustomerEmail] = React.useState<string>(
    initialCustomerEmail || "",
  );
  const [customerCompany, setCustomerCompany] = React.useState<string>(
    initialCustomerCompany || "",
  );
  const [customerPhone, setCustomerPhone] = React.useState<string>(
    initialCustomerPhone || "",
  );

  const [materials, setMaterials] = React.useState<MaterialOption[]>([]);
  const [materialsLoading, setMaterialsLoading] = React.useState<boolean>(true);
  const [materialsError, setMaterialsError] = React.useState<string | null>(null);
    const materialLabelFromUrlRef = React.useRef<string | null>(
    initialMaterialLabel || null,
  );

  const [selectedMaterialId, setSelectedMaterialId] =
  React.useState<number | null>(initialMaterialId);


  // Box suggester state (RSC + mailer suggestions)
  const [boxSuggest, setBoxSuggest] = React.useState<BoxSuggestState>({
    loading: false,
    error: null,
    bestRsc: null,
    bestMailer: null,
  });

  const [selectedCartonKind, setSelectedCartonKind] =
    React.useState<"RSC" | "MAILER" | null>(null);

  const handlePickCarton = React.useCallback(
    async (kind: "RSC" | "MAILER") => {
      // Update the visual selection immediately
      setSelectedCartonKind(kind);

      const chosen = kind === "RSC" ? boxSuggest.bestRsc : boxSuggest.bestMailer;
      const sku = chosen?.sku;

      const insideL = Number(chosen?.inside_length_in);
      const insideW = Number(chosen?.inside_width_in);
      if (Number.isFinite(insideL) && Number.isFinite(insideW) && insideL > 0 && insideW > 0) {
        const clearance = 0.125;
        const cand1 = { L: insideL - clearance, W: insideW - clearance };
        const cand2 = { L: insideW - clearance, W: insideL - clearance };

        const curL = Number(block.lengthIn) || 0;
        const curW = Number(block.widthIn) || 0;

        const score1 = Math.abs(cand1.L - curL) + Math.abs(cand1.W - curW);
        const score2 = Math.abs(cand2.L - curL) + Math.abs(cand2.W - curW);

        const pick = score2 < score1 ? cand2 : cand1;

        const nextL = snapInches(Math.max(pick.L, 0));
        const nextW = snapInches(Math.max(pick.W, 0));

        const layersToCheck =
          stack && stack.length > 0 ? stack : [{ cavities: cavities ?? [] }];

        let wouldClip = false;
        for (const layer of layersToCheck) {
          const cavs = (layer as any)?.cavities ?? [];
          for (const cav of cavs) {
            const left = Number(cav.x) * nextL;
            const top = Number(cav.y) * nextW;
            const right = left + Number(cav.lengthIn || 0);
            const bottom = top + Number(cav.widthIn || 0);
            if (right > nextL || bottom > nextW) {
              wouldClip = true;
              break;
            }
          }
          if (wouldClip) break;
        }

        if (wouldClip) {
          const ok = window.confirm(
            "This box would require shrinking the foam footprint and may clip existing cavities. Continue?",
          );
          if (ok) {
            updateBlockDims({ lengthIn: nextL, widthIn: nextW });
          }
        } else {
          updateBlockDims({ lengthIn: nextL, widthIn: nextW });
        }
      }

      // We need a quote number and a SKU to do anything useful
      if (!quoteNo || !sku) {
        console.warn("[layout] Skipping carton pick: missing quoteNo or sku", {
          quoteNo,
          sku,
        });
        return;
      }

      // Use the same qty as the layout / primary foam line, defaulting to 1
      const numericQty =
        typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : 1;

      const payload = {
        quote_no: quoteNo,
        sku,
        qty: numericQty,
      };

      console.log("[layout] handlePickCarton → /api/boxes/add-to-quote", payload);

      try {
        const res = await fetch("/api/boxes/add-to-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res
          .json()
          .catch(() => ({ ok: false, error: "non_json_response" }));

        console.log("[layout] /api/boxes/add-to-quote response", res.status, data);

        if (!res.ok) {
          console.error("Failed to add box to quote", res.status, data);
        }
      } catch (err) {
        console.error("Error in handlePickCarton /api/boxes/add-to-quote", err);
      }
    },
    [boxSuggest.bestRsc, boxSuggest.bestMailer, quoteNo, qty, block.lengthIn, block.widthIn, stack, cavities, updateBlockDims],
  );

  // Local input state for selected cavity dims (to avoid "wonky" inputs)
  const [cavityInputs, setCavityInputs] = React.useState<{
    id: string | null;
    length: string;
    width: string;
    depth: string;
    cornerRadius: string;
  }>({
    id: null,
    length: "",
    width: "",
    depth: "",
    cornerRadius: "",
  });

  React.useEffect(() => {
    if (!selectedCavity) {
      setCavityInputs({
        id: null,
        length: "",
        width: "",
        depth: "",
        cornerRadius: "",
      });
      return;
    }

    setCavityInputs({
      id: selectedCavity.id,
      length: selectedCavity.lengthIn != null ? String(selectedCavity.lengthIn) : "",
      width: selectedCavity.widthIn != null ? String(selectedCavity.widthIn) : "",
      depth: selectedCavity.depthIn != null ? String(selectedCavity.depthIn) : "",
      cornerRadius:
        selectedCavity.cornerRadiusIn != null
          ? String(selectedCavity.cornerRadiusIn)
          : "",
    });
  }, [selectedCavity]);

  const commitCavityField = React.useCallback(
    (field: "length" | "width" | "depth" | "cornerRadius") => {
      if (!selectedCavity || !cavityInputs.id || cavityInputs.id !== selectedCavity.id) {
        return;
      }

      const raw = cavityInputs[field];
      const parsed = Number(raw);

      const resetToCurrent = () => {
        setCavityInputs((prev) => ({
          ...prev,
          [field]:
            field === "length"
              ? String(selectedCavity.lengthIn ?? "")
              : field === "width"
              ? String(selectedCavity.widthIn ?? "")
              : field === "depth"
              ? String(selectedCavity.depthIn ?? "")
              : String(selectedCavity.cornerRadiusIn ?? ""),
        }));
      };

      if (!Number.isFinite(parsed) || parsed <= 0) {
        resetToCurrent();
        return;
      }

      const snapped = snapInches(parsed);

      // Circles keep length/width as the same "diameter"
      if (selectedCavity.shape === "circle" && (field === "length" || field === "width")) {
        updateCavityDims(selectedCavity.id, {
          lengthIn: snapped,
          widthIn: snapped,
        });
        setCavityInputs((prev) => ({
          ...prev,
          length: String(snapped),
          width: String(snapped),
        }));
        return;
      }

      if (field === "length") {
        updateCavityDims(selectedCavity.id, { lengthIn: snapped });
        setCavityInputs((prev) => ({ ...prev, length: String(snapped) }));
      } else if (field === "width") {
        updateCavityDims(selectedCavity.id, { widthIn: snapped });
        setCavityInputs((prev) => ({ ...prev, width: String(snapped) }));
      } else if (field === "depth") {
        updateCavityDims(selectedCavity.id, { depthIn: snapped });
        setCavityInputs((prev) => ({ ...prev, depth: String(snapped) }));
      } else {
        updateCavityDims(selectedCavity.id, { cornerRadiusIn: snapped });
        setCavityInputs((prev) => ({ ...prev, cornerRadius: String(snapped) }));
      }
    },
    [cavityInputs, selectedCavity, updateCavityDims],
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const res = await fetch("/api/materials", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();

        if (!cancelled && Array.isArray(json.materials)) {

          const mapped: MaterialOption[] = json.materials.map((m: any) => ({
            id: m.id,
            name:
              (m.name ?? m.material_name ?? `Material #${m.id}`) || `Material #${m.id}`,
            family: m.material_family || "Uncategorized",
            density_lb_ft3:
              typeof m.density_lb_ft3 === "number"
                ? m.density_lb_ft3
                : m.density_lb_ft3 != null
                ? Number(m.density_lb_ft3)
                : null,
          }));
          setMaterials(mapped);


// Form material seeding: resolve foam label → material ID (ONE TIME)
if (
  selectedMaterialId == null &&
  materialLabelFromUrlRef.current
) {
   const needle = materialLabelFromUrlRef.current.toLowerCase();
  const tokens = needle.split(/[^a-z0-9.]+/i).filter((t) => t.length >= 2);

  const match = mapped.find((m) => {
    const hay = `${m.name} ${m.family}`.toLowerCase();
    if (hay.includes(needle)) return true;
    return tokens.some((t) => hay.includes(t));
  });


  if (match) {
    setSelectedMaterialId(match.id);
    materialLabelFromUrlRef.current = null; // prevent re-run
  }
}


        }
      } catch (err) {
        console.error("Error loading materials for layout editor", err);
        if (!cancelled) {
          setMaterialsError("Couldn’t load material list. You can still edit the layout.");
        }
      } finally {
        if (!cancelled) {
          setMaterialsLoading(false);
        }
      }
    }

    loadMaterials();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Safe Family Grouping (no PE/EPE remap) ----
  const materialsByFamily = React.useMemo(() => {
    const map = new Map<string, MaterialOption[]>();

    for (const m of materials) {
      const safeName =
        (m.name && m.name.trim().length > 0 ? m.name : `Material #${m.id}`) ||
        `Material #${m.id}`;
      const key = m.family || "Other";

      const entry: MaterialOption = {
        ...m,
        name: safeName,
      };

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }

    for (const [, list] of map) {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    return Array.from(map.entries());
  }, [materials]);

  const missingCustomerInfo = !customerName.trim() || !customerEmail.trim();

  /* ---------- Palette interactions ---------- */

  const handleAddPreset = (shape: CavityShape) => {
  allowAutoPlaceRef.current = true;

  if (shape === "circle") {
    addCavity("circle", { lengthIn: 3, widthIn: 3, depthIn: 2 });
  } else if (shape === "roundedRect") {
    addCavity("roundedRect", {
      lengthIn: 4,
      widthIn: 3,
      depthIn: 2,
      cornerRadiusIn: 0.5,
    });
  } else {
    addCavity("rect", { lengthIn: 4, widthIn: 2, depthIn: 2 });
  }
};


  /* ---------- Center selected cavity ---------- */
  const handleCenterSelectedCavity = () => {
    if (!selectedCavity) return;

    const len = selectedCavity.lengthIn;
    const wid = selectedCavity.widthIn;

    if (!block.lengthIn || !block.widthIn || !len || !wid) return;

    let xIn = (block.lengthIn - len) / 2;
    let yIn = (block.widthIn - wid) / 2;

   xIn = snapCenterInches(xIn);
yIn = snapCenterInches(yIn);


    const minXIn = wallIn;
    const maxXIn = block.lengthIn - wallIn - len;
    const minYIn = wallIn;
    const maxYIn = block.widthIn - wallIn - wid;

    const clamp = (v: number, min: number, max: number) =>
      v < min ? min : v > max ? max : v;

    xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
    yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

    const xNorm = xIn / block.lengthIn;
    const yNorm = yIn / block.widthIn;

    updateCavityPosition(selectedCavity.id, xNorm, yNorm);
  };

  const clamp = (v: number, min: number, max: number) =>
    v < min ? min : v > max ? max : v;

  const nudgeSelected = React.useCallback(
    (dxIn: number, dyIn: number) => {
      if (!selectedCavity) return;

      const len = Number(selectedCavity.lengthIn) || 0;
      const wid = Number(selectedCavity.widthIn) || 0;

      if (!block.lengthIn || !block.widthIn || !len || !wid) return;

      const curXIn = (Number(selectedCavity.x) || 0) * block.lengthIn;
      const curYIn = (Number(selectedCavity.y) || 0) * block.widthIn;

      let nextXIn = snapInches(curXIn + dxIn);
      let nextYIn = snapInches(curYIn + dyIn);

      const minXIn = wallIn;
      const maxXIn = block.lengthIn - wallIn - len;
      const minYIn = wallIn;
      const maxYIn = block.widthIn - wallIn - wid;

      nextXIn = clamp(nextXIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
      nextYIn = clamp(nextYIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

      updateCavityPosition(
        selectedCavity.id,
        nextXIn / block.lengthIn,
        nextYIn / block.widthIn,
      );
    },
    [selectedCavity, block.lengthIn, block.widthIn, wallIn, updateCavityPosition],
  );

  const alignSelected = React.useCallback(
    (mode: "left" | "right" | "top" | "bottom" | "centerX" | "centerY") => {
      if (!block.lengthIn || !block.widthIn) return;

      // Advanced-only: align TWO selected cavities relative to the first-selected cavity.
      // - No block reference (except clamping to stay inside the block)
      // - No spacing enforcement
      if (editorMode === "advanced" && selectedIds.length === 2) {
        const a = selectedCavity;
        const b = secondSelectedCavity;
        if (!a || !b) return;

        const aX = (Number(a.x) || 0) * block.lengthIn;
        const aY = (Number(a.y) || 0) * block.widthIn;

        const aLen = Number(a.lengthIn) || 0;
        const aWid = Number(a.widthIn) || 0;

        const bLen = Number(b.lengthIn) || 0;
        const bWid = Number(b.widthIn) || 0;

        if (!aLen || !aWid || !bLen || !bWid) return;

        let nextXIn = (Number(b.x) || 0) * block.lengthIn;
        let nextYIn = (Number(b.y) || 0) * block.widthIn;

        if (mode === "left") nextXIn = aX;
        if (mode === "right") nextXIn = aX + aLen - bLen;
        if (mode === "top") nextYIn = aY;
        if (mode === "bottom") nextYIn = aY + aWid - bWid;
        if (mode === "centerX") nextXIn = aX + (aLen - bLen) / 2;
        if (mode === "centerY") nextYIn = aY + (aWid - bWid) / 2;

        nextXIn = snapInches(nextXIn);
        nextYIn = snapInches(nextYIn);

        const minXIn = 0;
        const maxXIn = block.lengthIn - bLen;
        const minYIn = 0;
        const maxYIn = block.widthIn - bWid;

        nextXIn = clamp(nextXIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
        nextYIn = clamp(nextYIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

        updateCavityPosition(b.id, nextXIn / block.lengthIn, nextYIn / block.widthIn);
        return;
      }

      // Single-cavity alignment (Basic + Advanced) — respects wall clamp in Basic.
      if (!selectedCavity) return;

      const len = Number(selectedCavity.lengthIn) || 0;
      const wid = Number(selectedCavity.widthIn) || 0;

      if (!len || !wid) return;

      const curXIn = (Number(selectedCavity.x) || 0) * block.lengthIn;
      const curYIn = (Number(selectedCavity.y) || 0) * block.widthIn;

      let nextXIn = curXIn;
      let nextYIn = curYIn;

      if (mode === "left") nextXIn = wallIn;
      if (mode === "right") nextXIn = block.lengthIn - wallIn - len;
      if (mode === "top") nextYIn = wallIn;
      if (mode === "bottom") nextYIn = block.widthIn - wallIn - wid;
      if (mode === "centerX") nextXIn = snapCenterInches((block.lengthIn - len) / 2);
if (mode === "centerY") nextYIn = snapCenterInches((block.widthIn - wid) / 2);


      if (mode === "centerX") nextXIn = snapCenterInches(nextXIn);
else nextXIn = snapInches(nextXIn);

if (mode === "centerY") nextYIn = snapCenterInches(nextYIn);
else nextYIn = snapInches(nextYIn);

      const minXIn = wallIn;
      const maxXIn = block.lengthIn - wallIn - len;
      const minYIn = wallIn;
      const maxYIn = block.widthIn - wallIn - wid;

      nextXIn = clamp(nextXIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
      nextYIn = clamp(nextYIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

      updateCavityPosition(
        selectedCavity.id,
        nextXIn / block.lengthIn,
        nextYIn / block.widthIn,
      );
    },
    [
      editorMode,
      selectedIds,
      selectedCavity,
      secondSelectedCavity,
      block.lengthIn,
      block.widthIn,
      wallIn,
      updateCavityPosition,
    ],
  );

  const duplicateSelected = React.useCallback(() => {
    if (!selectedCavity) return;

    const shape = selectedCavity.shape as any;

    if (shape === "circle") {
      addCavity("circle", {
        lengthIn: Number(selectedCavity.lengthIn) || 3,
        widthIn: Number(selectedCavity.widthIn) || 3,
        depthIn: Number(selectedCavity.depthIn) || 2,
      });
      return;
    }

    if (shape === "roundedRect") {
      addCavity("roundedRect", {
        lengthIn: Number(selectedCavity.lengthIn) || 4,
        widthIn: Number(selectedCavity.widthIn) || 3,
        depthIn: Number(selectedCavity.depthIn) || 2,
        cornerRadiusIn: Number((selectedCavity as any).cornerRadiusIn) || 0.5,
      });
      return;
    }

    addCavity("rect", {
      lengthIn: Number(selectedCavity.lengthIn) || 4,
      widthIn: Number(selectedCavity.widthIn) || 2,
      depthIn: Number(selectedCavity.depthIn) || 2,
    });
  }, [selectedCavity, addCavity]);

  React.useEffect(() => {
    if (editorMode !== "advanced") return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don’t steal keys while typing in inputs/textareas
      const tag = (e.target as any)?.tagName?.toLowerCase?.() || "";
      if (tag === "input" || tag === "textarea" || (e.target as any)?.isContentEditable) return;

      if (!selectedCavity) return;

      const step = e.shiftKey ? 1.0 : SNAP_IN;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeSelected(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelected(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeSelected(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeSelected(0, step);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorMode, selectedCavity, nudgeSelected]);

  const openFilePicker = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    const inputEl = e.currentTarget;

    try {
      const currentQuoteNo = (quoteNo || "").trim();
      if (!currentQuoteNo) {
        setUploadStatus("error");
        setUploadError("Missing quote_no in URL");
        return;
      }

      // ===== PDF HANDLING =====
      // PDFs need special handling - extract geometry, don't send to forge
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      
      if (isPdf) {
        setUploadStatus("uploading");
        setUploadError(null);
        
        // Upload PDF as attachment (NOT through sketch-upload/forge)
        const pdfFormData = new FormData();
        pdfFormData.append("file", file);
        pdfFormData.append("quote_no", currentQuoteNo);
        
        const uploadRes = await fetch('/api/quote-attachments/upload', {
          method: 'POST',
          body: pdfFormData
        });
        
        if (!uploadRes.ok) {
          throw new Error("PDF upload failed");
        }
        
        const uploadJson = await uploadRes.json();
        const attachmentId = uploadJson.attachment?.id || uploadJson.attachmentId;
        
        if (!attachmentId) {
          throw new Error("No attachment ID returned");
        }
        
        setUploadStatus("done");
        
        // Extract geometry from PDF
        try {
          const geomRes = await fetch('/api/quote/import-pdf-geometry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quote_no: currentQuoteNo,
              attachment_id: attachmentId
            })
          });
          
          const geomData = await geomRes.json();
          
          if (geomData.ok && geomData.blockDimensions && geomData.cavities) {
            const { blockDimensions, cavities } = geomData;
            const lengthIn = blockDimensions.lengthIn;
            const widthIn = blockDimensions.widthIn;
            
            const confirmed = window.confirm(
              `PDF geometry extracted!\n\n` +
              `Block: ${lengthIn.toFixed(2)}" × ${widthIn.toFixed(2)}"\n` +
              `Found ${cavities.length} cavities\n\n` +
              `Import this layout?`
            );
            
            if (confirmed && lengthIn > 0 && widthIn > 0) {
              updateBlockDims({ lengthIn, widthIn });
              
              const editorCavities = cavities.map((cav: any, idx: number) => {
                if (cav.type === "circle") {
                  return {
                    id: `cav_${Date.now()}_${idx}`,
                    shape: "circle" as const,
                    x: cav.x,
                    y: cav.y,
                    diameterIn: cav.diameterIn || 1,
                    depthIn: 1,
                    label: null,
                  };
                } else {
                  return {
                    id: `cav_${Date.now()}_${idx}`,
                    shape: "rect" as const,
                    x: cav.x,
                    y: cav.y,
                    lengthIn: cav.lengthIn || 1,
                    widthIn: cav.widthIn || 1,
                    depthIn: 1,
                    cornerRadiusIn: 0,
                    label: null,
                  };
                }
              });
              
              const layerSeed: any = {
                block: { lengthIn, widthIn, cornerStyle: "square" as const, chamferIn: 0 },
                stack: [{
                  id: `layer_${Date.now()}`,
                  label: `PDF Import`,
                  thicknessIn: 2,
                  materialId: initialMaterialId || null,
                  cavities: editorCavities,
                  cropCorners: false,
                }]
              };
              
              importLayerFromSeed(layerSeed, {
                mode: "replace",
                label: undefined,
                targetLayerId: activeLayerId,
              });
              
              alert(`PDF imported! ${cavities.length} cavities added.`);
            }
          } else {
            alert(`PDF uploaded but no geometry found.\n\nCreate layout manually.`);
          }
        } catch (e) {
          console.error('PDF extraction failed:', e);
          alert(`PDF uploaded but extraction failed.\n\nCreate layout manually.`);
        }
        
        inputEl.value = "";
        return; // EXIT EARLY - do not continue to DXF/STL handling
      }

      // ===== DXF/STL HANDLING =====
      // Continue with normal forge converter flow for non-PDF files
      const hasExistingLayers = Array.isArray(stack) && stack.length > 0;
      const hasExistingGeometry =
        hasExistingLayers && stack.some((layer) => (layer.cavities?.length ?? 0) > 0);

      const shouldPrompt = hasExistingLayers && (stack.length > 1 || hasExistingGeometry);

      let importMode: "append" | "replace" = "replace";

      if (shouldPrompt && typeof window !== "undefined") {
        const ok = window.confirm(
          "Import DXF:\nOK = Add as new layer (recommended)\nCancel = Replace current layer",
        );
        importMode = ok ? "append" : "replace";
      }

      setUploadStatus("uploading");
      setUploadError(null);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("filename", file.name);
      fd.append("quote_no", currentQuoteNo);
      fd.append("importMode", importMode);

      const base = "/api/sketch-upload";
      const url = `${base}?quote_no=${encodeURIComponent(currentQuoteNo)}&t=${Date.now()}`;

      const res = await fetch(url, { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }

      const json = await res.json().catch(() => null);
      if (!json || json.ok !== true) {
        setUploadStatus("error");
        const msg =
          (json && (json.error || json.detail?.error || json.detail?.errors?.[0]?.message)) ||
          "Upload failed";
        setUploadError(typeof msg === "string" ? msg : JSON.stringify(msg));
        return;
      }

     setUploadStatus("done");

     

// FIX: Instead of router.replace (which causes reload), fetch faces directly and update state
try {
  const latestRes = await fetch(
    `/api/quote-attachments/latest?quote_no=${encodeURIComponent(currentQuoteNo)}&filename=${encodeURIComponent("forge_faces.json")}&t=${Date.now()}`,
    { cache: "no-store" },
  );

  if (latestRes.ok) {
    const latestJson = await latestRes.json().catch(() => null);
    const attachmentId = Number(latestJson?.attachment?.id);

    if (Number.isFinite(attachmentId) && attachmentId > 0) {
      const facesDownload = await fetch(
        `/api/quote-attachments/${attachmentId}?t=${Date.now()}`,
        { cache: "no-store" },
      );

      if (facesDownload.ok) {
        const facesText = await facesDownload.text();
        const parsedFaces = JSON.parse(facesText);

        const seed = facesJsonToLayoutSeed(parsedFaces);

        if (
          seed.block?.cornerStyle === "chamfer" &&
          seed.block?.chamferIn &&
          seed.block.chamferIn > 0 &&
          Array.isArray(seed.stack)
        ) {
          seed.stack = seed.stack.map((layer: any) => ({
            ...layer,
            cropCorners: true,
          }));
        }

        const importLabel = file?.name ? `DXF: ${file.name}` : "";

        importLayerFromSeed(seed, {
          mode: importMode,
          label: importMode === "append" ? importLabel : undefined,
          targetLayerId: importMode === "replace" ? activeLayerId : null,
        });

        setUploadError(null);

        console.log("Converter file loaded successfully!");
      } else {
        setUploadError(`Failed to download converted file: ${facesDownload.status}`);
      }
    } else {
      setUploadError("Converter output not found. Please try again.");
    }
  } else {
    setUploadError(`Failed to fetch converter output: ${latestRes.status}`);
  }
} catch (err: any) {
  setUploadError(`Error loading converter output: ${String(err?.message || err)}`);
  console.error("Error loading faces after upload:", err);
}

return;
    } catch (err: any) {
      setUploadStatus("error");
      setUploadError(String(err?.message || err));
    } finally {
      inputEl.value = "";
    }
  };

/* ---------- Foam Advisor navigation ---------- */

const handleGoToFoamAdvisor = () => {
  if (missingCustomerInfo) return;
  if (typeof window === "undefined") return;

  // Build a return_to URL that includes the user's CURRENT form inputs.
  // The editor already supports URL-prefill for these keys, so this prevents state loss
  // when navigating away and coming back from /foam-advisor.
  const editorUrl = new URL(window.location.href);

  // Canonical customer keys (the editor reads these)
  editorUrl.searchParams.set("customer_name", (customerName || "").trim());
  editorUrl.searchParams.set("customer_email", (customerEmail || "").trim());

  const company = (customerCompany || "").trim();
  const phone = (customerPhone || "").trim();
  if (company) editorUrl.searchParams.set("customer_company", company);
  else editorUrl.searchParams.delete("customer_company");
  if (phone) editorUrl.searchParams.set("customer_phone", phone);
  else editorUrl.searchParams.delete("customer_phone");

  // Qty key (the editor reads qty/quantity/etc — use canonical qty)
  if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
    editorUrl.searchParams.set("qty", String(qty));
  } else {
    editorUrl.searchParams.delete("qty");
  }

  const params = new URLSearchParams();

  if (hasRealQuoteNo && quoteNo) {
    params.set("quote_no", quoteNo);
  }

  // Pass the FULL editor URL (now including current inputs)
  params.set("return_to", editorUrl.toString());

  router.push(`/foam-advisor?${params.toString()}`);
};



  /* ---------- Apply-to-Quote ---------- */

  // Sales credit (Path A): compute from current URL at apply-time.
  // This avoids relying on any specific state variable name/scope.
  const salesRepSlugForApply = (() => {
    try {
      if (typeof window === "undefined") return "";
      const url = new URL(window.location.href);
      const raw =
        url.searchParams.get("sales_rep_slug") ||
        url.searchParams.get("sales") ||
        url.searchParams.get("rep") ||
        "";
      return (raw || "").trim();
    } catch {
      return "";
    }
  })();

  const handleApplyToQuote = async () => {
    if (!hasRealQuoteNo) {
      alert("This layout isn’t linked to a quote.\nOpen from a real quote email.");
      return;
    }

    if (missingCustomerInfo) {
      alert("Add customer name + email before applying to quote.");
      return;
    }

    try {
      setApplyStatus("saving");

      const selectedMaterial =
        selectedMaterialId != null
          ? materials.find((m) => m.id === selectedMaterialId) || null
          : null;

      let materialLabel: string | null = null;
      if (selectedMaterial) {
        const familyLabel =
          (selectedMaterial.family && selectedMaterial.family.trim()) ||
          (selectedMaterial.name && selectedMaterial.name.trim()) ||
          "";

        let densityLabel: string | null = null;
        if (
          typeof selectedMaterial.density_lb_ft3 === "number" &&
          Number.isFinite(selectedMaterial.density_lb_ft3)
        ) {
          densityLabel = `${selectedMaterial.density_lb_ft3.toFixed(1)} pcf`;
        }

        materialLabel = densityLabel ? `${familyLabel}, ${densityLabel}` : familyLabel || null;
      }

      // NEW (must-fix): build a durable layout object FIRST, then generate SVG from it.
      // Reason: previously we generated SVG from `layout` BEFORE writing cornerStyle/chamferIn,
      // so exports were always square even when the checkbox was checked.
      const layoutToSave: any = {
        ...(layout as any),
        block: { ...((layout as any).block ?? {}) },
      };

      // Editor mode (persisted with layout; backward-compatible)
      layoutToSave.editorMode = editorMode === "advanced" ? "advanced" : "basic";

      // Per-layer crop corners: stored on each layer.
      // Do NOT write block.cornerStyle here anymore.
      if (layoutToSave.stack && Array.isArray(layoutToSave.stack)) {
        layoutToSave.stack = layoutToSave.stack.map((l: any) => ({
          ...l,
          cropCorners: !!l.cropCorners,
          roundCorners: !!l.roundCorners,
          roundRadiusIn:
            l.roundCorners
              ? Number.isFinite(Number(l.roundRadiusIn)) && Number(l.roundRadiusIn) > 0
                ? Number(l.roundRadiusIn)
                : DEFAULT_ROUND_RADIUS_IN
              : Number.isFinite(Number(l.roundRadiusIn))
                ? Number(l.roundRadiusIn)
                : undefined,
        }));
      }

      const activeLayerForSave =
        Array.isArray(layoutToSave.stack) && layoutToSave.stack.length > 0
          ? layoutToSave.stack.find((l: any) => l.id === activeLayerId) ?? layoutToSave.stack[0]
          : null;

      // Set cornerStyle based on cropCorners flag, but PRESERVE existing chamferIn if present
      // (forge may have already detected a chamfer with a specific size)
      if (activeLayerForSave?.cropCorners) {
        layoutToSave.block.cornerStyle = "chamfer";
        // Only set chamferIn to 1 if it's not already set (preserve forge-detected value)
        if (!layoutToSave.block.chamferIn || layoutToSave.block.chamferIn <= 0) {
          layoutToSave.block.chamferIn = 1;
        }
      } else {
        layoutToSave.block.cornerStyle = "square";
        layoutToSave.block.chamferIn = null;
      }

      // IMPORTANT: Build SVG from the SAME layout object we are saving.
      const svg = buildSvgFromLayout(layoutToSave as LayoutModel, {
        notes: notes && notes.trim().length > 0 ? notes.trim() : undefined,
        materialLabel: materialLabel || undefined,
        cropCorners: !!activeLayerForSave?.cropCorners,
        roundCorners: !!activeLayerForSave?.roundCorners,
        roundRadiusIn: activeLayerForSave?.roundRadiusIn,
      });

      const payload: any = {
        quoteNo,
        layout: layoutToSave,
        notes,
        svg,
        customer: {
          name: customerName.trim(),
          email: customerEmail.trim(),
          company: customerCompany.trim() || null,
          phone: customerPhone.trim() || null,
        },
      };

      // Sales credit: pass through to backend; backend will only set if quote.sales_rep_id is NULL.
      if (salesRepSlugForApply && salesRepSlugForApply.length > 0) {
        payload.sales_rep_slug = salesRepSlugForApply;
      }

      // Attach chosen carton (if any) so the backend can add a box line item
      if (selectedCartonKind && (boxSuggest.bestRsc || boxSuggest.bestMailer)) {
        const chosen = selectedCartonKind === "RSC" ? boxSuggest.bestRsc : boxSuggest.bestMailer;

        if (chosen) {
          payload.selectedCarton = {
            style: chosen.style,
            sku: chosen.sku,
            description: chosen.description,
            inside_length_in: chosen.inside_length_in,
            inside_width_in: chosen.inside_width_in,
            inside_height_in: chosen.inside_height_in,
            fit_score: chosen.fit_score,
            notes: chosen.notes ?? null,
          };
        }
      }

      // Attach foam layers summary so the backend can add each pad as a line item
      if (layers && layers.length > 0) {
        payload.foamLayers = layers.map((layer) => ({
          id: layer.id,
          label: layer.label,
          thicknessIn: getLayerThickness(layer.id),
        }));
      }

      const nQty = Number(qty);
      if (Number.isFinite(nQty) && nQty > 0) {
        payload.qty = nQty;
      }
      if (selectedMaterialId != null) {
        payload.materialId = selectedMaterialId;
      }

      const res = await fetch("/api/quote/layout/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let payloadJson: any = null;
        try {
          payloadJson = await res.json();
          if (payloadJson?.error === "quote_not_found") {
            alert(
              `Couldn’t find a quote header for ${quoteNo}.\nOpen this link from a real quote email.`,
            );
          }
        } catch {
          // ignore
        }
        throw new Error(`HTTP ${res.status}`);
      }

      if (typeof window !== "undefined") {
        window.location.href = "/quote?quote_no=" + encodeURIComponent(quoteNo);
        return;
      }

      setApplyStatus("done");
      setTimeout(() => setApplyStatus("idle"), 2000);
    } catch (err) {
      console.error("Apply-to-quote failed", err);
      setApplyStatus("error");
      setTimeout(() => setApplyStatus("idle"), 3000);
    }
  };

  /* ---------- Layout ---------- */

  const canApplyButton = hasRealQuoteNo && !missingCustomerInfo && applyStatus !== "saving";

  // Qty used for box/carton suggestions (null when not set)
  const effectiveQty = typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : null;

  // Call /api/boxes/suggest whenever the layout + customer info are ready
  React.useEffect(() => {
    const lengthIn = Number(block.lengthIn) || 0;
    const widthIn = Number(block.widthIn) || 0;
    const stackDepthIn = totalStackThicknessIn || 0;

    // If we don't have enough info yet, reset state and bail.
    if (!hasRealQuoteNo || missingCustomerInfo || lengthIn <= 0 || widthIn <= 0 || stackDepthIn <= 0) {
      setBoxSuggest({
        loading: false,
        error: null,
        bestRsc: null,
        bestMailer: null,
      });
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setBoxSuggest((prev) => ({
          ...prev,
          loading: true,
          error: null,
        }));

        const res = await fetch("/api/boxes/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            footprint_length_in: lengthIn,
            footprint_width_in: widthIn,
            stack_depth_in: stackDepthIn,
            qty: effectiveQty ?? null,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = await res.json();

        if (cancelled) return;

        if (!json || json.ok !== true) {
          setBoxSuggest({
            loading: false,
            error:
              (json && typeof json.error === "string" && json.error) ||
              "No carton suggestion returned.",
            bestRsc: null,
            bestMailer: null,
          });
          return;
        }

        setBoxSuggest({
          loading: false,
          error: null,
          bestRsc: json.bestRsc ?? null,
          bestMailer: json.bestMailer ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("Box suggester call failed", err);
        setBoxSuggest({
          loading: false,
          error: "Couldn’t calculate cartons right now.",
          bestRsc: null,
          bestMailer: null,
        });
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    hasRealQuoteNo,
    missingCustomerInfo,
    block.lengthIn,
    block.widthIn,
    totalStackThicknessIn,
    effectiveQty,
  ]);

  // Derived labels used in multiple spots
  const footprintLabel =
    Number(block.lengthIn) > 0 && Number(block.widthIn) > 0
      ? `${Number(block.lengthIn).toFixed(2)}" × ${Number(block.widthIn).toFixed(2)}"`
      : "—";

  const stackDepthLabel = totalStackThicknessIn > 0 ? `${totalStackThicknessIn.toFixed(2)}"` : "—";

  const qtyLabel = effectiveQty != null ? effectiveQty.toLocaleString() : "—";

  const suggesterReady =
    hasRealQuoteNo &&
    !missingCustomerInfo &&
    Number(block.lengthIn) > 0 &&
    Number(block.widthIn) > 0 &&
    totalStackThicknessIn > 0;

  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),transparent_60%),radial-gradient(circle_at_bottom,_rgba(37,99,235,0.14),transparent_60%)] flex items-stretch py-8 px-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf,.pdf,.stl"
        className="hidden"
        onChange={handleFileSelected}
      />
      <div className="w-full max-w-none mx-auto">
        <div className="relative rounded-2xl border border-slate-800/80 bg-slate-950/90 shadow-[0_26px_60px_rgba(15,23,42,0.95)] overflow-hidden">
          {/* global grid/glow overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-65 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),transparent_55%),linear-gradient(to_right,rgba(15,23,42,0.95)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.95)_1px,transparent_1px)] [background-size:460px_460px,28px_28px,28px_28px]"
          />
          <div className="relative">
            {/* Header */}
            <div className="border-b border-slate-800/80 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
              <div className="flex items-center gap-4 w-full">
                {/* LEFT: powered by + quote */}
                <div className="flex flex-col">
                  <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-sky-50/90">
                    Powered by Alex-IO
                  </div>
                  <div className="mt-1 text-xs text-sky-50/95">
                    Quote{" "}
                    <span className="font-mono font-semibold text-slate-50">{quoteNo}</span>
                    {hasRealQuoteNo ? (
                      <span className="ml-1 text-sky-100/90">· Linked to active quote</span>
                    ) : (
                      <span className="ml-1 text-amber-50/90">· Demo view (no quote linked)</span>
                    )}
                  </div>
                </div>

                {/* CENTER: stylized title */}
                <div className="flex-1 text-center">
                  <div className="inline-flex flex-col items-center gap-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100/70">
                      Foam layout tools
                    </div>
                    <div className="text-2xl md:text-[26px] font-extrabold leading-snug bg-gradient-to-r from-sky-50 via-cyan-200 to-sky-100 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(15,23,42,0.9)]">
                      Interactive foam layout editor
                    </div>
                  </div>
                </div>

                {/* RIGHT: BETA pill */}
                <div className="flex items-center justify-end gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-sky-50">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.95)]" />
                    Layout editor · BETA
                  </span>
                </div>
              </div>
            </div>

            {/* How this works */}
            <div className="border-b border-slate-800/80 bg-slate-950/95 px-6 py-3 text-[11px] text-slate-200 flex flex-wrap items-start gap-4">
              <div className="flex items-center gap-2 font-semibold text-sky-200">
                <span className="inline-flex h-5 w-1.5 items-center justify-center rounded-full border border-sky-400/70 bg-sky-500/20 text-[10px] font-bold shadow-[0_0_14px_rgba(56,189,248,0.7)]">
                  ?
                </span>
                How this layout editor works
              </div>

              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                <li>
                  <span className="text-sky-300 mr-1">1.</span>
                  Adjust the foam block, add cavities from the left palette.
                </li>
                <li>
                  <span className="text-sky-300 mr-1">2.</span>
                  Drag / resize in the center canvas to fine-tune placement.
                </li>
                <li>
                  <span className="text-sky-300 mr-1">3.</span>
                  Fill in customer + material, then{" "}
                  <span className="font-semibold text-sky-200">Apply to quote</span>.
                </li>
              </ul>
            </div>

            {/* Compressed top metrics + controls row */}
            <div className="px-5 pt-3 pb-2 bg-slate-950/95 border-b border-slate-900/80">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* LEFT: Layers summary + quick metrics + block dims */}
                <div
                  data-guided="layers"
                  className={`rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 text-[11px] text-slate-200 ${guidedClass("layers")}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">
                        Layers
                      </span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-200">
                        <span>
                          {layers && layers.length > 0 ? (
                            <>
                              {layers.length} layer{layers.length > 1 ? "s" : ""} · Active:{" "}
                              <span className="font-semibold text-slate-50">
                                {activeLayerDisplayLabel}
                              </span>
                            </>
                          ) : (
                            "Single foam block"
                          )}
                        </span>
                        <span className="text-slate-400">
                          · Footprint{" "}
                          <span className="font-mono text-slate-100">{footprintLabel}</span>
                        </span>
                        <span className="text-slate-400">
                          · Stack depth{" "}
                          <span className="font-mono text-slate-100">{stackDepthLabel}</span>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addLayer}
                      className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10 transition"
                    >
                      + Layer
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-400">Length (in)</span>
                      <input
  type="number"
  step={0.125}
  value={blockInputs.length}
  onChange={(e) => setBlockInputs((prev) => ({ ...prev, length: e.target.value }))}
  onBlur={() => commitBlockDimField("length")}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitBlockDimField("length");
      (e.currentTarget as HTMLInputElement).blur();
    }
  }}
  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
/>

                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-400">Width (in)</span>
                      <input
  type="number"
  step={0.125}
  value={blockInputs.width}
  onChange={(e) => setBlockInputs((prev) => ({ ...prev, width: e.target.value }))}
  onBlur={() => commitBlockDimField("width")}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitBlockDimField("width");
      (e.currentTarget as HTMLInputElement).blur();
    }
  }}
  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
/>

                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-400">Active layer thick (in)</span>
                      <input
                        type="number"
                        step={0.125}
                        value={activeLayer ? getLayerThickness(activeLayer.id) : blockThicknessIn}
                        onChange={(e) => handleActiveLayerThicknessChange(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
  <span className="font-semibold text-slate-300">Fit note:</span>{" "}
  Foam OD is typically undersized <span className="font-semibold">0.125"</span> to ensure it fits into a box/mailer
  (unless you specify otherwise).
</div>


                  {/* NEW: thin layer summary strip (visual balance) */}
                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                    <span>
                      Active{" "}
                      <span className="text-slate-100 font-semibold">
                        {activeLayerDisplayLabel ?? "—"}
                      </span>
                    </span>
                    <span>
                      · Stack{" "}
                      <span className="font-mono text-slate-100">{stackDepthLabel}</span>
                    </span>
                    <span>
                      · Footprint{" "}
                      <span className="font-mono text-slate-100">{footprintLabel}</span>
                    </span>
                  </div>
                </div>

                {/* CENTER: Layout controls (Zoom + Qty + CTA buttons) */}
                <div
                  data-guided="apply"
                  className={`rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 flex flex-col justify-between ${guidedClass("apply")}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-400/80" />
                      Layout controls
                    </div>

                    {/* Editor mode toggle */}
                    <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 p-0.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setEditorMode("basic")}
                        className={
                          "px-2.5 py-0.5 rounded-full transition " +
                          (editorMode === "basic"
                            ? "bg-sky-500 text-slate-950 font-semibold"
                            : "text-slate-300 hover:text-slate-100")
                        }
                      >
                        Basic
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorMode("advanced")}
                        className={
                          "px-2.5 py-0.5 rounded-full transition " +
                          (editorMode === "advanced"
                            ? "bg-amber-400 text-slate-950 font-semibold"
                            : "text-slate-300 hover:text-slate-100")
                        }
                      >
                        Advanced
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400">
                    Quoted qty: <span className="font-mono text-slate-50">{qtyLabel}</span>
                  </div>

                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-1">
                      <span>Zoom</span>
                      <input
                        type="range"
                        min={0.7}
                        max={1.4}
                        step={0.05}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="w-32 accent-sky-400"
                      />
                      <span className="ml-1 text-sky-200 font-mono">{Math.round(zoom * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Qty</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={qty}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setQty("");
                            return;
                          }
                          const num = Number(v);
                          if (!Number.isFinite(num) || num <= 0) return;
                          setQty(num);
                        }}
                        disabled={!hasRealQuoteNo}
                        className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {editorMode === "advanced" && (
                    <div className="mb-2 rounded-xl border border-slate-700/80 bg-slate-950/45 px-3 py-2 text-[11px] text-slate-200">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold text-slate-50">
                          <span className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.8)]" />
                          Advanced tools
                        </div>
                        <span className="rounded-full border border-amber-300/25 bg-slate-950/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-100/80">
                          Live
                        </span>
                      </div>

                      <div className="mt-1 text-slate-300/80">
                        Select a cavity, then use Align / Duplicate, or nudge with{" "}
                        <span className="font-semibold text-slate-100">Arrow keys</span> (Shift = 1&quot;).
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={duplicateSelected}
                          disabled={!selectedCavity}
                          className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-100 disabled:opacity-50"
                        >
                          Duplicate selected
                        </button>

                        <button
                          type="button"
                          onClick={handleCenterSelectedCavity}
                          disabled={!selectedCavity}
                          className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-100 disabled:opacity-50"
                        >
                          Center in block
                        </button>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => alignSelected("left")}
                          disabled={!selectedCavity}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-50"
                        >
                          Align Left
                        </button>
                        <button
                          type="button"
                          onClick={() => alignSelected("centerX")}
                          disabled={!selectedCavity}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-50"
                        >
                          Center X
                        </button>
                        <button
                          type="button"
                          onClick={() => alignSelected("right")}
                          disabled={!selectedCavity}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-50"
                        >
                          Align Right
                        </button>

                        <button
                          type="button"
                          onClick={() => alignSelected("top")}
                          disabled={!selectedCavity}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-50"
                        >
                          Align Top
                        </button>
                        <button
                          type="button"
                          onClick={() => alignSelected("centerY")}
                          disabled={!selectedCavity}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-50"
                        >
                          Center Y
                        </button>
                        <button
                          type="button"
                          onClick={() => alignSelected("bottom")}
                          disabled={!selectedCavity}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-50"
                        >
                          Align Bottom
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGoToFoamAdvisor}
                      disabled={missingCustomerInfo}
                      className="inline-flex flex-1 items-center justify-center rounded-full border border-sky-500/60 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-500/10 hover:border-sky-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Recommend my foam
                    </button>

                    <button
                      type="button"
                      onClick={openFilePicker}
                      disabled={uploadStatus === "uploading"}
                      className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition disabled:opacity-60"
                    >
                      {uploadStatus === "uploading" ? "Uploading" : "Upload file"}
                    </button>

                    <button
                      type="button"
                      onClick={handleApplyToQuote}
                      disabled={!canApplyButton}
                      className="inline-flex flex-1 items-center justify-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition disabled:opacity-60"
                    >
                      {!hasRealQuoteNo
                        ? "Link to a quote first"
                        : missingCustomerInfo
                        ? "Add name + email"
                        : applyStatus === "saving"
                        ? "Applying…"
                        : applyStatus === "done"
                        ? "Applied!"
                        : applyStatus === "error"
                        ? "Error – retry"
                        : "Apply to quote"}
                    </button>
                  </div>
                  {uploadStatus === "error" && uploadError ? (
                    <div className="mt-1 text-[11px] text-red-300">{uploadError}</div>
                  ) : null}
                </div>

                {/* RIGHT: Layer details (stack + per-layer list + per-layer crop) */}
                <div
                  data-guided="layer-details"
                  className={`rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 text-[11px] text-slate-200 ${guidedClass("layer-details")}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">
                        Layer details
                      </span>
                      <span className="text-xs text-slate-200">
                        Stack depth:{" "}
                        <span className="font-mono text-slate-50">{stackDepthLabel}</span>
                      </span>

                      {/* NEW: subtle helper line (visual density only) */}
                      <span className="text-[10px] text-slate-500">
                        Per-layer thickness &amp; edge treatment
                      </span>
                    </div>
                  </div>

                  {layers && layers.length > 0 ? (
                    <div className="max-h-32 overflow-auto space-y-1 mt-0.5">
                      {layers.map((layer, layerIndex) => {
                        const isActive = activeLayer?.id === layer.id;
                        const layerThick = getLayerThickness(layer.id);
                        const isCrop = !!(layer as any).cropCorners;
                        const isRound = !!(layer as any).roundCorners;
                        const roundRadiusRaw = Number((layer as any).roundRadiusIn);
                        const roundRadius =
                          Number.isFinite(roundRadiusRaw) && roundRadiusRaw > 0
                            ? roundRadiusRaw
                            : DEFAULT_ROUND_RADIUS_IN;

                        return (
                          <div
                            key={layer.id}
                            className={
                              "rounded-lg border px-2.5 py-1 flex items-center justify-between gap-2 " +
                              (isActive
                                ? "border-sky-500/80 bg-sky-500/10"
                                : "border-slate-700 bg-slate-900/80 hover:border-sky-400/70")
                            }
                          >
                            <div className="flex flex-col gap-0.5 flex-1">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveLayerId(layer.id)}
                                  className={
                                    "text-xs font-medium " +
                                    (isActive ? "text-sky-100" : "text-slate-100")
                                  }
                                >
                                  {layerDisplayLabel(layerIndex)}
                                </button>
                                <span className="text-[10px] text-slate-400">· Thickness (in)</span>
                                <input
                                  type="number"
                                  step={0.125}
                                  value={layerThick}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const num = Number(v);
                                    if (!Number.isFinite(num) || num <= 0) return;
                                    setLayerThicknessIn(layer.id, num);
                                  }}
                                  className="w-16 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-100"
                                />
                                <label
                                  className="ml-2 flex items-center gap-1 text-xs text-slate-400"
                                  title={isCrop ? "Disable Crop to enable Round corners." : undefined}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isCrop}
                                    onChange={(e) => {
                                      const next = e.currentTarget.checked;
                                      setLayerCropCorners(layer.id, next);
                                      if (next && isRound) {
                                        setLayerRoundCorners(layer.id, false);
                                      }
                                    }}
                                  />
                                  Crop
                                </label>
                                <label className="ml-2 flex items-center gap-1 text-xs text-slate-400">
                                  <input
                                    type="checkbox"
                                    checked={isRound}
                                    disabled={isCrop}
                                    onChange={(e) => {
                                      const next = e.currentTarget.checked;
                                      setLayerRoundCorners(layer.id, next);
                                      if (next && isCrop) {
                                        setLayerCropCorners(layer.id, false);
                                      }
                                    }}
                                  />
                                  Round
                                </label>
                                <label className="ml-2 flex items-center gap-1 text-xs text-slate-400">
                                  <span>Radius (in)</span>
                                  <input
                                    type="number"
                                    step={0.01}
                                    min={0}
                                    value={roundRadiusDrafts[layer.id] ?? String(roundRadius)}
                                    disabled={!isRound}
                                    onChange={(e) => {
                                      setRoundRadiusDrafts((prev) => ({
                                        ...prev,
                                        [layer.id]: e.target.value,
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      commitRoundRadius(layer.id, roundRadius, e.currentTarget.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitRoundRadius(layer.id, roundRadius, (e.currentTarget as HTMLInputElement).value);
                                        (e.currentTarget as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="w-16 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-100 disabled:opacity-60"
                                  />
                                </label>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">ID: {layer.id}</span>
                              {stack && stack.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => deleteLayer(layer.id)}
                                  className="text-[11px] text-slate-400 hover:text-red-400"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-400">
                      Single-layer foam block. Add layers from the panel on the left if this layout needs multiple pads.
                    </div>
                  )}
                </div>
              </div>
            </div>

   

            {/* Body: three-column layout */}
            <div className="flex flex-row gap-5 p-5 bg-slate-950/90 text-slate-100 min-h-[620px]">
              {/* LEFT: Cavity palette + material + cartons + notes */}
              <aside className="w-52 shrink-0 flex flex-col gap-3">
                <div data-guided="cavity-palette" className={guidedClass("cavity-palette")}>
                  <div className="text-xs font-semibold text-slate-100 mb-1">Cavity palette</div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Click a style to add a new pocket, then drag and resize it in the block.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleAddPreset("rect")}
                  className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
                >
                  <div className="font-semibold text-slate-50 flex items-center gap-2">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-slate-400/70 bg-slate-900/80" />
                    Rectangle
                  </div>
                  <div className="text-[11px] text-slate-400">Rectangular pocket (4&quot; × 2&quot;)</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddPreset("circle")}
                  className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
                >
                  <div className="font-semibold text-slate-50 flex items-center gap-2">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400/70 bg-slate-900/80" />
                    Circle
                  </div>
                  <div className="text-[11px] text-slate-400">Round pocket (3&quot; Ø)</div>
                </button>
              {editorMode === "advanced" && (
                              <button
                                type="button"
                                onClick={() => handleAddPreset("roundedRect")}
                                className="w-full text-left rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs hover:border-sky-400 hover:bg-sky-500/10 transition"
                              >
                                <div className="font-semibold text-slate-50 flex items-center gap-2">
                                  <span className="inline-flex h-4 w-6 items-center justify-center rounded-[4px] border border-slate-400/70 bg-slate-900/80" />
                                  Rounded rectangle
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  Rounded corners (4&quot; × 3&quot;, 0.5&quot; R)
                                </div>
                              </button>
              )}

              {editorMode === "basic" && (
  <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
    Need rounded pockets? Switch to{" "}
    <button
      type="button"
      onClick={() => setEditorMode("advanced")}
      className="font-semibold text-amber-200 hover:text-amber-100 underline underline-offset-2"
    >
      Advanced
    </button>
    .
  </div>
)}


                {/* Foam material (in left bar) */}
                <div data-guided="foam-material" className={`mt-2 ${guidedClass("foam-material")}`}>
                  <div className="text-xs font-semibold text-slate-100 mb-1">Foam material</div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Choose the foam family and grade used for this layout.
                  </div>
                  <select
                    value={selectedMaterialId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        setSelectedMaterialId(null);
                      } else {
                        const parsed = Number(v);
                        if (Number.isFinite(parsed)) setSelectedMaterialId(parsed);
                      }
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="">
                      {materialsLoading ? "Loading materials…" : "Select material (optional)"}
                    </option>
                    {materialsByFamily.map(([family, list]) => (
                      <optgroup key={family} label={family}>
                        {list.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.density_lb_ft3 != null ? ` · ${m.density_lb_ft3.toFixed(1)} lb/ft³` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {materialsError && <div className="mt-1 text-[11px] text-amber-300">{materialsError}</div>}
                </div>

                {/* Closest matching cartons (live suggester, always visible) */}
                <div
                  data-guided="box-suggester"
                  className={`mt-3 rounded-2xl border border-slate-800 bg-slate-900/85 p-3 ${guidedClass("box-suggester")}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold text-slate-100">Closest matching cartons</div>
                    <span className="inline-flex items-center rounded-full bg-slate-800/90 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                      Box suggester · BETA
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 mb-2">
                    Uses the foam footprint{" "}
                    <span className="font-mono text-sky-200">{footprintLabel}</span>, stack depth{" "}
                    <span className="font-mono text-sky-200">{stackDepthLabel}</span> and quoted qty{" "}
                    <span className="font-mono text-sky-200">{qtyLabel}</span> to suggest a best-fit{" "}
                    <span className="text-sky-300 font-medium">RSC</span> and{" "}
                    <span className="text-sky-300 font-medium">mailer</span>.
                  </p>

                  {selectedCartonKind && (
                    <div className="mb-2 text-[11px] text-sky-200">
                      Selected carton:{" "}
                      <span className="font-mono">
                        {selectedCartonKind === "RSC" ? boxSuggest.bestRsc?.sku : boxSuggest.bestMailer?.sku}
                      </span>
                    </div>
                  )}

                  {!suggesterReady ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
                      <div className="font-semibold text-slate-100 mb-1">Waiting for layout &amp; customer info…</div>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li>Set block length, width and stack depth.</li>
                        <li>Enter customer name + email.</li>
                        {hasRealQuoteNo ? null : <li>Link this layout to a real quote.</li>}
                      </ul>
                    </div>
                  ) : boxSuggest.loading ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200">
                      Calculating best-fit cartons…
                    </div>
                  ) : boxSuggest.error ? (
                    <div className="rounded-xl border border-amber-500/70 bg-amber-900/40 px-3 py-2 text-[11px] text-amber-50">
                      {boxSuggest.error}
                    </div>
                  ) : !boxSuggest.bestRsc && !boxSuggest.bestMailer ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
                      No good carton matches found in the current stub catalog.
                    </div>
                  ) : (
                    <div className="space-y-2 text-[11px]">
                      {boxSuggest.bestRsc && (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2">
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="font-semibold text-slate-100">Best RSC match</div>
                            <span className="font-mono text-sky-300 text-[10px]">{boxSuggest.bestRsc.sku}</span>
                          </div>
                          <div className="text-slate-300">{boxSuggest.bestRsc.description}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-400">
                            <span>
                              Inside{" "}
                              <span className="font-mono text-slate-50">
                                {boxSuggest.bestRsc.inside_length_in}" × {boxSuggest.bestRsc.inside_width_in}" ×{" "}
                                {boxSuggest.bestRsc.inside_height_in}"
                              </span>
                            </span>
                            <span className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200">
                              Fit score: {boxSuggest.bestRsc.fit_score}
                            </span>
                          </div>

                          {boxSuggest.bestRsc.notes && (
                            <div className="mt-0.5 text-slate-400">{boxSuggest.bestRsc.notes}</div>
                          )}

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handlePickCarton("RSC")}
                              className={
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium " +
                                (selectedCartonKind === "RSC"
                                  ? "border-sky-400 bg-sky-500/20 text-sky-50"
                                  : "border-slate-600 bg-slate-900/80 text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10")
                              }
                            >
                              {selectedCartonKind === "RSC" ? "Selected carton" : "Pick this box"}
                            </button>
                          </div>
                        </div>
                      )}

                      {boxSuggest.bestMailer && (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2">
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="font-semibold text-slate-100">Best mailer match</div>
                            <span className="font-mono text-sky-300 text-[10px]">{boxSuggest.bestMailer.sku}</span>
                          </div>
                          <div className="text-slate-300">{boxSuggest.bestMailer.description}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-400">
                            <span>
                              Inside{" "}
                              <span className="font-mono text-slate-50">
                                {boxSuggest.bestMailer.inside_length_in}" × {boxSuggest.bestMailer.inside_width_in}" ×{" "}
                                {boxSuggest.bestMailer.inside_height_in}"
                              </span>
                            </span>
                            <span className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200">
                              Fit score: {boxSuggest.bestMailer.fit_score}
                            </span>
                          </div>

                          {boxSuggest.bestMailer.notes && (
                            <div className="mt-0.5 text-slate-400">{boxSuggest.bestMailer.notes}</div>
                          )}

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handlePickCarton("MAILER")}
                              className={
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium " +
                                (selectedCartonKind === "MAILER"
                                  ? "border-sky-400 bg-sky-500/20 text-sky-50"
                                  : "border-slate-600 bg-slate-900/80 text-slate-200 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10")
                              }
                            >
                              {selectedCartonKind === "MAILER" ? "Selected carton" : "Pick this box"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notes / special instructions */}
                <div
                  data-guided="notes"
                  className={`mt-2 bg-slate-900/80 rounded-2xl border border-slate-700 p-3 ${guidedClass("notes")}`}
                >
                  <div className="text-xs font-semibold text-slate-100 mb-1">Notes / special instructions</div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Optional text for anything the foam layout needs to call out (loose parts, labels, extra protection,
                    etc.). This will be saved with the quote when you apply.
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 resize-vertical"
                  />
                </div>

                <div className="mt-1 border-t border-slate-800 pt-2 text-[11px] text-slate-500 space-y-1">
  <div>
    Cavities snap to 0.125&quot; and keep 0.5&quot; walls to block edges and between pockets.
  </div>
  </div>


                {!hasRealQuoteNo && (
                  <div className="mt-3 rounded-xl border border-amber-500/70 bg-amber-900/50 px-3 py-2 text-[11px] text-amber-50">
                    No quote is linked yet. Open this page from an emailed quote or the /quote print view to save layouts
                    back to a real quote.
                  </div>
                )}
              </aside>

              {/* CENTER: Big visualizer */}
              <section
                data-guided="canvas"
                className={`flex-1 flex flex-col gap-3 ${guidedClass("canvas")}`}
              >
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-slate-50">
                      <span className="font-semibold">Foam layout preview</span>
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/60 text-sky-100 text-[11px] font-medium">
                        Interactive layout
                      </span>
                    </div>
                    {!hasRealQuoteNo && (
                      <div className="text-[11px] text-amber-300 mt-1">
                        Demo only – link from a real quote email to apply layouts.
                      </div>
                    )}
                  </div>
                  {!guided.enabled && (
                    <button
                      type="button"
                      onClick={guided.start}
                      className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[11px] font-medium text-amber-300 hover:border-sky-400 hover:text-amber-200 hover:bg-sky-500/10 transition"
                    >
                      Start Guided Input
                    </button>
                  )}
                  <div aria-hidden="true" />
                </div>

                <p className="text-[11px] text-slate-400 leading-snug">
                  Drag cavities to adjust placement. Use the square handle at the bottom-right of each cavity to resize.
                  Cavities are placed inside a 0.5&quot; wall on all sides. When a cavity is selected, the nearest
                  horizontal and vertical gaps to other cavities and to the block edges are dimensioned.
                </p>

                {/* canvas wrapper */}
                <div className="relative flex-1 rounded-2xl border border-slate-800/90 bg-slate-950 overflow-hidden shadow-[0_22px_55px_rgba(15,23,42,0.95)]">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 opacity-80 bg-[radial-gradient(circle_at_center,_rgba(15,23,42,0.96),transparent_56%),linear-gradient(to_right,rgba(30,64,175,0.3)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,64,175,0.3)_1px,transparent_1px)] [background-size:560px_560px,24px_24px,24px_24px]"
                  />
                  <div className="relative p-4 overflow-auto">
                  <InteractiveCanvas
  layout={layout}
  
  selectedIds={selectedIds}
  selectAction={selectCavity}
  moveAction={(id, xNorm, yNorm) => {
    // Sticky selection:
    // If this cavity is already part of the current selection (incl. 2-select),
    // don't collapse selection while dragging.
    if (!selectedIds.includes(id)) {
      selectCavity(id);
    }
    updateCavityPosition(id, xNorm, yNorm);
  }}
  resizeAction={(id, lengthIn, widthIn) => updateCavityDims(id, { lengthIn, widthIn })}
  zoom={zoom}
  croppedCorners={croppedCorners}
  roundCorners={roundCorners}
  roundRadiusIn={roundRadiusIn}
/>

                  </div>
                </div>

                {/* Box suggester preview + bottom cartons row (hidden for now, JSX preserved) */}
                {false && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-200">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-semibold text-slate-100">Box suggester inputs</div>
                        <span className="inline-flex items-center rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                          Preview only
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-2">
                        These are the dimensions and quantity the box suggester will use. Next step is wiring this into
                        the real Box Partners lookup.
                      </p>
                      <div className="space-y-1.5 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Foam footprint (L × W)</span>
                          <span className="font-mono text-slate-50">
                            {Number(block.lengthIn).toFixed(2)}" × {Number(block.widthIn).toFixed(2)}"
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Stack depth</span>
                          <span className="font-mono text-slate-50">{totalStackThicknessIn.toFixed(2)}"</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Quoted quantity</span>
                          <span className="font-mono text-slate-50">{qtyLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                      <div className="text-xs font-semibold text-slate-100 mb-1">Closest matching cartons (coming soon)</div>
                      <p className="text-[11px] text-slate-400 mb-2">
                        This panel will show the best fit <span className="text-sky-300 font-medium">RSC</span> and{" "}
                        <span className="text-sky-300 font-medium">mailer</span> for the foam stack above, based on the
                        Box Partners catalog. The selection will be saved back to the quote when you apply.
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2">
                          <div className="text-[11px] font-semibold text-slate-100">Best RSC match</div>
                          <div className="text-[11px] text-slate-500">
                            Will show: part number, inside dims, and fit score.
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2">
                          <div className="text-[11px] font-semibold text-slate-100">Best Mailer match</div>
                          <div className="text-[11px] text-slate-500">
                            Will show: part number, inside dims, and fit score.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* RIGHT: Customer info + cavities list */}
              <aside className="w-72 min-w-[260px] shrink-0 flex flex-col gap-3">
                {/* Customer info card */}
                <div
                  data-guided="customer-info"
                  className={`bg-slate-900 rounded-2xl border border-slate-800 p-3 ${guidedClass("customer-info")}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold text-slate-100">Customer info</div>
                    <span
                      className={
                        "inline-flex h-1.5 w-1.5 rounded-full " +
                        (missingCustomerInfo && hasRealQuoteNo
                          ? "bg-rose-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]"
                          : "bg-emerald-400/70 shadow-[0_0_7px_rgba(52,211,153,0.85)]")
                      }
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    Add who this foam layout is for.{" "}
                    <span className="text-sky-300">
                      Name + email are required before recommending foam or applying to the quote.
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">
                        Customer name <span className="text-rose-300">*</span>
                      </span>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">Company (optional)</span>
                      <input
                        type="text"
                        value={customerCompany}
                        onChange={(e) => setCustomerCompany(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">
                        Email <span className="text-rose-300">*</span>
                      </span>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-300">Phone (optional)</span>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                      />
                    </label>
                  </div>

                  {missingCustomerInfo && hasRealQuoteNo && (
                    <div className="mt-2 text-[11px] text-amber-300">
                      Enter a name and email to enable <span className="font-semibold">Recommend my foam</span> and{" "}
                      <span className="font-semibold">Apply to quote</span>.
                    </div>
                  )}
                </div>

                {/* Cavities list + editor */}
                <div
                  data-guided="cavity-editor"
                  className={`bg-slate-900 rounded-2xl border border-slate-800 p-3 flex-1 flex flex-col ${guidedClass("cavity-editor")}`}
                >
                  <div className="text-xs font-semibold text-slate-100">
                    Cavities
                    {activeLayerDisplayLabel && (
                      <span className="ml-1 text-[11px] font-normal text-slate-400">
                        — {activeLayerDisplayLabel}
                      </span>
                    )}
                  </div>

                  {cavities.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-400">
                      No cavities yet. Use the palette on the left to add a pocket.
                    </div>
                  ) : (
                    <ul className="mt-2 space-y-1.5 mb-3 max-h-40 overflow-auto">
                      {cavities.map((cav, cavIndex) => {
                        const isActive = selectedIds.includes(cav.id);

                        const color = CAVITY_COLORS[cavIndex % CAVITY_COLORS.length];
                        const inactiveBg = `${color}33`;
                        const chipStyle = {
                          backgroundColor: isActive ? color : inactiveBg,
                          color: isActive ? "#020617" : "#e5e7eb",
                        } as React.CSSProperties;

                        return (
                          <li
                            key={cav.id}
                            className={`flex items-center justify-between gap-2 rounded-lg px-1 py-1 ${
                              isActive ? "bg-slate-800/80" : "bg-slate-900/40 hover:bg-slate-800/50"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => (isActive ? selectCavity(null) : selectCavity(cav.id))}
                              className="flex-1 flex items-center gap-2 text-xs text-left"
                            >
                              <span
                                style={chipStyle}
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold"
                              >
                                {formatCavityChip(cav.id)}
                              </span>
                              <span className={isActive ? "text-slate-50 font-medium" : "text-slate-200"}>
                                {cav.label}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCavity(cav.id)}
                              className="text-[11px] text-slate-500 hover:text-red-400"
                              title="Delete cavity"
                            >
                              ✕
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                    {selectedCavity ? (
                      <span>
                        Editing <strong className="text-slate-100">{selectedCavity.label}</strong>
                      </span>
                    ) : (
                      <span>Select a cavity above to edit its size and depth.</span>
                    )}
                  </div>

                  {selectedCavity && (
                    <>
                      {selectedCavity.shape === "circle" ? (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-400">Diameter (in)</span>
                            <input
                              type="number"
                              step={0.125}
                              value={cavityInputs.length}
                              onChange={(e) => setCavityInputs((prev) => ({ ...prev, length: e.target.value }))}
                              onBlur={() => commitCavityField("length")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitCavityField("length");
                                }
                              }}
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-400">Depth (in)</span>
                            <input
                              type="number"
                              step={0.125}
                              value={cavityInputs.depth}
                              onChange={(e) => setCavityInputs((prev) => ({ ...prev, depth: e.target.value }))}
                              onBlur={() => commitCavityField("depth")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitCavityField("depth");
                                }
                              }}
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-400">Length (in)</span>
                            <input
                              type="number"
                              step={0.125}
                              value={cavityInputs.length}
                              onChange={(e) => setCavityInputs((prev) => ({ ...prev, length: e.target.value }))}
                              onBlur={() => commitCavityField("length")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitCavityField("length");
                                }
                              }}
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-400">Width (in)</span>
                            <input
                              type="number"
                              step={0.125}
                              value={cavityInputs.width}
                              onChange={(e) => setCavityInputs((prev) => ({ ...prev, width: e.target.value }))}
                              onBlur={() => commitCavityField("width")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitCavityField("width");
                                }
                              }}
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-400">Depth (in)</span>
                            <input
                              type="number"
                              step={0.125}
                              value={cavityInputs.depth}
                              onChange={(e) => setCavityInputs((prev) => ({ ...prev, depth: e.target.value }))}
                              onBlur={() => commitCavityField("depth")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitCavityField("depth");
                                }
                              }}
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </label>
                          {editorMode === "advanced" && selectedCavity.shape === "roundedRect" && (
                                                      <label className="flex flex-col gap-1">
                                                        <span className="text-[11px] text-slate-400">Corner radius (in)</span>
                                                        <input
                                                          type="number"
                                                          step={0.125}
                                                          value={cavityInputs.cornerRadius}
                                                          onChange={(e) => setCavityInputs((prev) => ({ ...prev, cornerRadius: e.target.value }))}
                                                          onBlur={() => commitCavityField("cornerRadius")}
                                                          onKeyDown={(e) => {
                                                            if (e.key === "Enter") {
                                                              e.preventDefault();
                                                              commitCavityField("cornerRadius");
                                                            }
                                                          }}
                                                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                                        />
                                                      </label>
                          )}

                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleCenterSelectedCavity}
                        className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-1 text-[11px] font-medium text-slate-100 hover:border-sky-400 hover:text-sky-100 hover:bg-sky-500/10 transition"
                      >
                        Center this cavity in block
                      </button>
                    </>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
      {guided.enabled && (
        <div className="fixed bottom-4 right-4 z-50 w-[260px] rounded-2xl border border-amber-500/70 bg-slate-950/95 p-3 text-[11px] text-slate-100 shadow-[0_18px_40px_rgba(15,23,42,0.6)]">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
            GUIDED INPUT
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-100">
            Step {guided.stepIndex + 1} of {guided.steps.length} - {guidedStepLabel}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={guided.prev}
              disabled={guided.stepIndex === 0}
              className="inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-100 disabled:opacity-50"
            >
              Back
            </button>
            {isLastGuidedStep ? (
              <button
                type="button"
                onClick={guided.finish}
                className="inline-flex items-center justify-center rounded-full border border-sky-500/80 bg-sky-500 px-3 py-1 text-[11px] font-semibold text-slate-950 hover:bg-sky-400 transition"
              >
                Finish
              </button>
            ) : (
              <button
                type="button"
                onClick={guided.next}
                className="inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-100 hover:border-sky-400 hover:text-sky-100"
              >
                Next
              </button>
            )}
            <button
              type="button"
              onClick={guided.stop}
              className="ml-auto inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-200 hover:border-slate-500"
            >
              Exit
            </button>
          </div>
          <button
            type="button"
            onClick={guided.finish}
            className="mt-2 text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
          >
            Don't show again
          </button>
        </div>
      )}
    </main>
  );
}
const formatCavityChip = (id: string): string => {
  if (!id) return "C";

  // Seeded cavities: seed-cav-1 → C1
  if (id.startsWith("seed-cav-")) {
    const n = id.slice("seed-cav-".length).trim();
    return n ? `C${n}` : "C";
  }

  // Normal cavities: cav-1 → C1
  if (id.startsWith("cav-")) {
    const n = id.slice("cav-".length).trim();
    return n ? `C${n}` : "C";
  }

  // Fallback: grab first number anywhere
  const m = id.match(/(\d+)/);
  if (m?.[1]) return `C${m[1]}`;

  return "C";
};


/* ---------- SVG export helper ---------- */

function buildSvgFromLayout(
  layout: LayoutModel,
  meta?: {
    notes?: string;
    materialLabel?: string | null;
    cropCorners?: boolean;
    roundCorners?: boolean;
    roundRadiusIn?: number;
  },
): string {
  const { block, cavities } = layout;

  const L = Number(block.lengthIn) || 0;
  const W = Number(block.widthIn) || 0;
  const T = Number(block.thicknessIn) || 0;

  const VIEW_W = 1000;
  const VIEW_H = 700;
  const PADDING = 40;

  if (L <= 0 || W <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}"></svg>`;
  }

  const scaleX = (VIEW_W - 2 * PADDING) / L;
  const scaleY = (VIEW_H - 2 * PADDING) / W;
  const scale = Math.min(scaleX, scaleY);

  const blockW = L * scale;
  const blockH = W * scale;
  const blockX = (VIEW_W - blockW) / 2;
  const blockY = (VIEW_H - blockH) / 2;

  const escapeText = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const cavects: string[] = [];

  for (const c of cavities) {
    const cavW = Number(c.lengthIn) * scale;
    const cavH = Number(c.widthIn) * scale;
    const x = blockX + Number(c.x) * blockW;
    const y = blockY + Number(c.y) * blockH;

    const label = (c as any).label ?? `${c.lengthIn}×${c.widthIn}×${(c as any).depthIn}"`;

    // Check if cavity has custom points array (polygon shape)
    const hasPoints = Array.isArray((c as any).points) && (c as any).points.length > 0;
    
    if (hasPoints) {
      // Render custom polygon from points array
      const points = (c as any).points as Array<{x: number, y: number}>;
      
      const svgPoints = points.map(pt => {
        const px = blockX + (pt.x * blockW);
        const py = blockY + (pt.y * blockH);
        return `${px.toFixed(2)},${py.toFixed(2)}`;
      }).join(' ');
      
      cavects.push(
        [
          `<g>`,
          `  <polygon points="${svgPoints}" fill="none" stroke="#111827" stroke-width="1" />`,
          `  <text x="${(x + cavW / 2).toFixed(2)}" y="${(y + cavH / 2).toFixed(
            2,
          )}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#111827">${escapeText(
            label,
          )}</text>`,
          `</g>`,
        ].join("\n"),
      );
    }
    // Circle shape
    else if ((c as any).shape === "circle") {
      const r = Math.min(cavW, cavH) / 2;
      const cx = x + cavW / 2;
      const cy = y + cavH / 2;
      cavects.push(
        [
          `<g>`,
          `  <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(
            2,
          )}" fill="none" stroke="#111827" stroke-width="1" />`,
          `  <text x="${cx.toFixed(2)}" y="${cy.toFixed(
            2,
          )}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#111827">${escapeText(
            label,
          )}</text>`,
          `</g>`,
        ].join("\n"),
      );
    } 
    // Rectangle (with optional rounded corners)
    else {
      const isRounded = (c as any).shape === "roundedRect";
      const rIn = Number((c as any).cornerRadiusIn) || 0;
      const rPx = isRounded ? Math.max(0, rIn) * scale : 0;
      const rx = Math.min(rPx, cavW / 2, cavH / 2);
      const ry = rx;

      cavects.push(
        [
          `<g>`,
          `  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cavW.toFixed(
            2,
          )}" height="${cavH.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="#111827" stroke-width="1" />`,
          `  <text x="${(x + cavW / 2).toFixed(2)}" y="${(y + cavH / 2).toFixed(
            2,
          )}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#111827">${escapeText(
            label,
          )}</text>`,
          `</g>`,
        ].join("\n"),
      );
    }
  }

  const cavRects = cavects.join("\n");

  const headerLines: string[] = [];
  headerLines.push("NOT TO SCALE");
  headerLines.push(`FIT NOTE: FOAM OD UNDERSIZED ${FOAM_FIT_UNDERSIZE_IN.toFixed(3)}" FOR BOX/MAILER FIT (UNLESS SPECIFIED)`);

  if (T > 0) {
    headerLines.push(`BLOCK: ${L}" × ${W}" × ${T}"`);
  } else {
    headerLines.push(`BLOCK: ${L}" × ${W}" (thickness see quote)`);
  }
  if (meta?.materialLabel) {
    headerLines.push(`MATERIAL: ${meta.materialLabel}`);
  }

  const headerTexts = headerLines
    .map((line, idx) => {
      const y = PADDING + idx * 14;
      const fontSize = idx === 0 ? 11 : 10;
      return `<text x="${PADDING.toFixed(2)}" y="${y.toFixed(
        2,
      )}" font-size="${fontSize}" fill="#111827">${escapeText(line)}</text>`;
    })
    .join("\n    ");

  const headerSection = `<g>
    ${headerTexts}
  </g>`;

  const metaLines: string[] = [];
  if (meta?.notes && meta.notes.trim().length > 0) {
    const rawNotes = meta.notes.trim();
    const cleaned = rawNotes
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !/^FOAM(?:\s+BLOCK)?:/i.test(line) &&
          !/^BLOCK:/i.test(line) &&
          !/^CAVITY/i.test(line) &&
          !/^FOAM:/i.test(line) &&
          !/^MATERIAL:/i.test(line),
      );

    if (cleaned.length > 0) {
      metaLines.push(`Notes: ${cleaned.join("  ")}`);
    }
  }

  let metaSection = "";
  if (metaLines.length > 0) {
    const notesTexts = metaLines
      .map((line, idx) => {
        const y = VIEW_H - PADDING + idx * 14;
        return `<text x="${PADDING.toFixed(2)}" y="${y.toFixed(
          2,
        )}" font-size="10" fill="#111827">${escapeText(line)}</text>`;
      })
      .join("\n    ");

    metaSection = `<g>
    ${notesTexts}
  </g>`;
  }

  const svgParts: string[] = [];

  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">`,
  );

  svgParts.push(`  ${headerSection}`);

    // --- Block outline (square OR chamfer) ---
  const cornerStyle = String((block as any)?.cornerStyle ?? "").toLowerCase();
  const chamferInRaw = (block as any)?.chamferIn;
  const chamferIn = chamferInRaw == null ? 0 : Number(chamferInRaw);

  const wantsRound = !!meta?.roundCorners;
  const roundRaw = Number(meta?.roundRadiusIn);
  const roundRadiusIn =
    Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : DEFAULT_ROUND_RADIUS_IN;

  const chamferPx =
    !wantsRound && (meta?.cropCorners || cornerStyle === "chamfer") && Number.isFinite(chamferIn) && chamferIn > 0
      ? chamferIn * scale
      : 0;

  // Clamp chamfer so it can't exceed half the side
  const c = Math.max(
    0,
    Math.min(chamferPx, blockW / 2 - 0.01, blockH / 2 - 0.01),
  );

  const roundPx = wantsRound ? roundRadiusIn * scale : 0;
  const r = Math.max(0, Math.min(roundPx, blockW / 2 - 0.01, blockH / 2 - 0.01));

  if (r > 0.001) {
    svgParts.push(
      `  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}" width="${blockW.toFixed(
        2,
      )}" height="${blockH.toFixed(
        2,
      )}" rx="${r.toFixed(2)}" ry="${r.toFixed(2)}" fill="#e5e7eb" stroke="#111827" stroke-width="2" />`,
    );
  } else if (c > 0.001) {
    const x0 = blockX;
    const y0 = blockY;
    const x1 = blockX + blockW;
    const y1 = blockY + blockH;

    // Chamfered rectangle path (45° chamfers)
        // 2-corner chamfer ONLY:
    // - Top-left corner chamfered
    // - Bottom-right corner chamfered
    const d = [
      // start just right of top-left chamfer
      `M ${(x0 + c).toFixed(2)} ${y0.toFixed(2)}`,

      // top edge to top-right (square)
      `L ${x1.toFixed(2)} ${y0.toFixed(2)}`,

      // right edge down to just above bottom-right chamfer
      `L ${x1.toFixed(2)} ${(y1 - c).toFixed(2)}`,

      // bottom-right chamfer
      `L ${(x1 - c).toFixed(2)} ${y1.toFixed(2)}`,

      // bottom edge to bottom-left (square)
      `L ${x0.toFixed(2)} ${y1.toFixed(2)}`,

      // left edge up to just below top-left chamfer
      `L ${x0.toFixed(2)} ${(y0 + c).toFixed(2)}`,

      // top-left chamfer back to start
      `L ${(x0 + c).toFixed(2)} ${y0.toFixed(2)}`,

      `Z`,
    ].join(" ");


    svgParts.push(
      `  <path d="${d}" fill="#e5e7eb" stroke="#111827" stroke-width="2" />`,
    );
  } else {
    svgParts.push(
      `  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}" width="${blockW.toFixed(
        2,
      )}" height="${blockH.toFixed(2)}" rx="0" ry="0" fill="#e5e7eb" stroke="#111827" stroke-width="2" />`,
    );
  }


  if (cavRects) {
    svgParts.push(cavRects);
  }

  if (metaSection) {
    svgParts.push(metaSection);
  }

  svgParts.push(`</svg>`);

  return svgParts.join("\n");
}
