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

type LayerIntent = {
  layerCount?: number | null;
  thicknesses?: number[] | null;
  cavityLayerIndex?: number | null;
};

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

  const first = Array.isArray(raw) ? raw.find((s) => s && s.trim()) : raw;
  if (!first) return null;

  const s = first.trim();
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
          const t = Number(item?.thicknessIn ?? item?.thickness ?? item?.t);
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
            .map((x: any) => Number(x))
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
  const parts = s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
  const thicknesses = parts
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (thicknesses.length === 0) return null;

  const labels = thicknesses.map((_, i) => `Layer ${i + 1}`);
  return { thicknesses, labels };
}

/**
 * Read per-layer cavities from search params:
 *  - cavities_l1=1x1x.5;2x2x1
 *  - cavity_l2=... (repeatable)
 */
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

/* "LxW" or "LxWxD" parser (depth default 1") */
function parseCavityDims(raw: string): {
  L: number;
  W: number;
  D: number;
} | null {
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const num = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
  const tripleRe = new RegExp(`(${num})\\s*[x×]\\s*(${num})\\s*[x×]\\s*(${num})`);
  const doubleRe = new RegExp(`(${num})\\s*[x×]\\s*(${num})`);

  let m = t.match(tripleRe);
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    const D = Number(m[3]) || 0;
    if (!L || !W || !D) return null;
    return { L, W, D };
  }
  m = t.match(doubleRe);
  if (m) {
    const L = Number(m[1]) || 0;
    const W = Number(m[2]) || 0;
    if (!L || !W) return null;
    return { L, W, D: 1 };
  }
  return null;
}

function snapInches(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

export default function LayoutPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
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
      const raw = searchParams?.material_id as string | string[] | undefined;
      if (!raw) return null;
      const first = Array.isArray(raw) ? raw[0] : raw;
      const parsed = Number(first);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    });

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const midRaw = url.searchParams.get("material_id");
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
  const [initialNotes, setInitialNotes] = React.useState<string>("");
  const [initialQty, setInitialQty] = React.useState<number | null>(null);
  const [initialMaterialId, setInitialMaterialId] =
    React.useState<number | null>(null);

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

      const block = {
        lengthIn: parsedBlock.L,
        widthIn: parsedBlock.W,
        thicknessIn: parsedBlock.H,
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
          .filter(Boolean) as { L: number; W: number; D: number }[];

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

            cavities.push({
              id: `cav-${idx + 1}`,
              label: `${c.L}×${c.W}×${c.D} in`,
              shape: "rect",
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

      // Legacy single-layer return.
      if (
        !layersInfo ||
        !layersInfo.thicknesses ||
        layersInfo.thicknesses.length === 0
      ) {
        return { block, cavities };
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
          ? buildFallbackLayout(blockStr, cavStrToUse, null, null) // recursion, no layers
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
        activeLayerId: stack[0]?.id ?? null,
      } as any;
    },
    [],
  );
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      const materialIdOverride = materialIdFromUrl;
      setLoadingLayout(true);

      // Re-read dims/cavities from the actual address bar.
      let effectiveBlockStr = serverBlockStr;
      let effectiveCavityStr = serverCavityStr;

      // Multi-layer info parsed from URL (if present), passed into buildFallbackLayout.
      let layersInfo: { thicknesses: number[]; labels: string[] } | null = null;
      let perLayerCavityStrs: string[] | null = null;

      // Used only as a “don’t accidentally load DB layout” gate.
      let layerIntent: LayerIntent | undefined = undefined;

      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);

          // dims
          const dimsCandidates: string[] = [];
          const dimsA = url.searchParams.get("dims");
          const dimsB = url.searchParams.get("block");
          if (dimsA) dimsCandidates.push(dimsA);
          if (!dimsA && dimsB) dimsCandidates.push(dimsB);

          // cavities (merge both keys)
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

          // 1) Support layers=... and repeated layer=...
          const layersRaw =
            url.searchParams.get("layers") ??
            (url.searchParams.getAll("layer").length > 0
              ? url.searchParams.getAll("layer").join(",")
              : null);

          layersInfo = layersRaw ? parseLayersParam(layersRaw) : null;

          if (layersInfo && layersInfo.thicknesses.length > 0) {
            perLayerCavityStrs = layersInfo.thicknesses.map((_, i) =>
              readLayerCavitiesFromUrl(url, i + 1),
            );
            layerIntent = {
              layerCount: layersInfo.thicknesses.length,
              thicknesses: layersInfo.thicknesses,
            };
          }

          // 2) ALSO support Alex-IO link params:
          // layer_count=3&layer_thicknesses=1,4,1&layer_cavity_layer_index=1
          if (
            !layersInfo ||
            !layersInfo.thicknesses ||
            layersInfo.thicknesses.length === 0
          ) {
            const lcRaw = url.searchParams.get("layer_count");
            const thRaw = url.searchParams.get("layer_thicknesses");
            const cliRaw = url.searchParams.get("layer_cavity_layer_index");

            const lc = lcRaw ? Number(lcRaw) : NaN;
            const cli = cliRaw ? Number(cliRaw) : NaN;

            if (Number.isFinite(lc) && lc > 1) {
              const parsed = (thRaw || "")
                .split(/[,;]/)
                .map((s) => Number(String(s).trim()))
                .filter((n) => Number.isFinite(n) && n > 0);

              let thicknesses = parsed.slice(0, lc);

              // If we got fewer thicknesses than layer_count:
              // 1) try to infer from dims height remainder
              // 2) otherwise fill missing layers with 0.5"
              if (thicknesses.length < lc) {
                const blockParsed = parseDimsTriple(effectiveBlockStr);
                const H = blockParsed?.H;

                if (Number.isFinite(H) && (H as number) > 0) {
                  const used = thicknesses.reduce((a, b) => a + b, 0);
                  const remaining = (H as number) - used;

                  if (remaining > 0.01) {
                    thicknesses = [...thicknesses, remaining];
                  }
                }

                while (thicknesses.length < lc) {
                  thicknesses = [...thicknesses, 0.5];
                }
              }

              const labels = thicknesses.map((_, i) =>
                i === 0
                  ? "Bottom"
                  : i === thicknesses.length - 1
                  ? "Top"
                  : `Layer ${i + 1}`,
              );

              layersInfo = { thicknesses, labels };

              const cavityIdx =
                Number.isFinite(cli) && cli >= 0 && cli < thicknesses.length
                  ? Math.floor(cli)
                  : thicknesses.length === 3
                  ? 1
                  : 0;

              // Put all generic cavities onto cavityIdx
              perLayerCavityStrs = thicknesses.map((_, i) =>
                i === cavityIdx ? effectiveCavityStr : "",
              );

              layerIntent = {
                layerCount: thicknesses.length,
                thicknesses,
                cavityLayerIndex: cavityIdx,
              };
            }
          }
        }
      } catch {
        // If anything goes wrong, we fall back to serverBlockStr/serverCavityStr.
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
            setInitialNotes("");
            setInitialQty(null);
            setInitialMaterialId(materialIdOverride ?? null);
            // no header to pull customer info from in demo mode
            setInitialCustomerName("");
            setInitialCustomerEmail("");
            setInitialCustomerCompany("");
            setInitialCustomerPhone("");
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
            setInitialNotes("");
            setInitialQty(null);
            setInitialMaterialId(materialIdOverride ?? null);
            setInitialCustomerName("");
            setInitialCustomerEmail("");
            setInitialCustomerCompany("");
            setInitialCustomerPhone("");
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

          if (!cancelled) {
            setInitialCustomerName((qh.customer_name ?? "").toString());
            setInitialCustomerEmail((qh.email ?? "").toString());
            // Company isn’t stored on quotes table yet; keep blank for now.
            setInitialCustomerCompany("");
            setInitialCustomerPhone((qh.phone ?? "").toString());
          }
        } else if (!cancelled) {
          // No header → clear initial customer fields
          setInitialCustomerName("");
          setInitialCustomerEmail("");
          setInitialCustomerCompany("");
          setInitialCustomerPhone("");
        }

        // Prefer DB layout when it contains a real multi-layer stack,
        // even if URL dims/cavities are present (those are often legacy links).
        const dbLayout = json?.layoutPkg?.layout_json as LayoutModel | undefined;
        const dbHasStack =
          !!dbLayout &&
          Array.isArray((dbLayout as any).stack) &&
          (dbLayout as any).stack.length > 0;

        if (json && json.ok && dbLayout && dbHasStack) {
          const notesFromDb = (json.layoutPkg.notes as string | null) ?? "";

          if (!cancelled) {
            setInitialLayout(dbLayout);
            setInitialNotes(notesFromDb);
            setInitialQty(qtyFromItems);
            setInitialMaterialId(materialIdOverride ?? materialIdFromItems);
            setLoadingLayout(false);
          }
          return;
        }

        // Only use DB layout geometry when NO URL dims/cavities are present
        // AND there is no multi-layer intent coming from the original email link.
        if (
          json &&
          json.ok &&
          json.layoutPkg &&
          json.layoutPkg.layout_json &&
          !hasExplicitCavities &&
          !hasDimsFromUrl &&
          !hasCavitiesFromUrl &&
          !layerIntent
        ) {
          const layoutFromDb = json.layoutPkg.layout_json as LayoutModel;
          const notesFromDb = (json.layoutPkg.notes as string | null) ?? "";

          if (!cancelled) {
            setInitialLayout(layoutFromDb);
            setInitialNotes(notesFromDb);
            setInitialQty(qtyFromItems);
            setInitialMaterialId(materialIdOverride ?? materialIdFromItems);
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
          setInitialNotes("");
          setInitialQty(qtyFromItems);
          setInitialMaterialId(materialIdOverride ?? materialIdFromItems);
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
          setInitialNotes("");
          setInitialQty(null);
          setInitialMaterialId(materialIdOverride ?? null);
          setInitialCustomerName("");
          setInitialCustomerEmail("");
          setInitialCustomerCompany("");
          setInitialCustomerPhone("");
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
      quoteNo={quoteNo}
      hasRealQuoteNo={hasRealQuoteNo}
      initialLayout={initialLayout}
      initialNotes={initialNotes}
      initialQty={initialQty}
      initialMaterialId={initialMaterialId}
      initialCustomerName={initialCustomerName}
      initialCustomerEmail={initialCustomerEmail}
      initialCustomerCompany={initialCustomerCompany}
      initialCustomerPhone={initialCustomerPhone}
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
  initialCustomerName: string;
  initialCustomerEmail: string;
  initialCustomerCompany: string;
  initialCustomerPhone: string;
}) {
  const {
    quoteNo,
    hasRealQuoteNo,
    initialLayout,
    initialNotes,
    initialQty,
    initialMaterialId,
    initialCustomerName,
    initialCustomerEmail,
    initialCustomerCompany,
    initialCustomerPhone,
  } = props;

  const router = useRouter();

  const {
    layout,
    selectedId,
    activeLayerId,
    selectCavity,
    setActiveLayerId,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
    addLayer,
    renameLayer,
    deleteLayer,
  } = useLayoutModel(initialLayout);

  const { block, cavities, stack } = layout as LayoutModel & {
    stack?: {
      id: string;
      label: string;
      cavities: any[];
      thicknessIn?: number;
    }[];
  };

  const blockThicknessIn = Number(block.thicknessIn) || 0;

  // Thickness source of truth:
  // - layout.stack[].thicknessIn
  // - fallback: block.thicknessIn only for legacy / single-layer layouts without thicknessIn seeded
  const [thicknessTick, setThicknessTick] = React.useState(0);

  const getLayerThickness = React.useCallback(
    (layerId: string): number => {
      const layer =
        stack && stack.length > 0 ? stack.find((l) => l.id === layerId) ?? null : null;

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

  const activeLayerLabel = activeLayer?.label ?? null;
  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  // Multi-layer: derive layers view if stack exists
  const layers = layout.stack && layout.stack.length > 0 ? layout.stack : null;

  const effectiveActiveLayerId =
    layers && layers.length > 0 ? activeLayerId ?? layers[0].id : null;

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
  }, [effectiveActiveLayerId, layerCount, selectCavity, layers]);

  // When a new cavity is added, try to drop it into "dead space"
  const prevCavityCountRef = React.useRef<number>(cavities.length);
  React.useEffect(() => {
    const prevCount = prevCavityCountRef.current;

    if (
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

        const usableLen = Math.max(block.lengthIn - 2 * WALL_IN, cavLen);
        const usableWid = Math.max(block.widthIn - 2 * WALL_IN, cavWid);

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
            const centerXIn = WALL_IN + cellW * (col + 0.5);
            const centerYIn = WALL_IN + cellH * (row + 0.5);

            let xIn = centerXIn - cavLen / 2;
            let yIn = centerYIn - cavWid / 2;

            const minXIn = WALL_IN;
            const maxXIn = block.lengthIn - WALL_IN - cavLen;
            const minYIn = WALL_IN;
            const maxYIn = block.widthIn - WALL_IN - cavWid;

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

          const minXIn = WALL_IN;
          const maxXIn = block.lengthIn - WALL_IN - cavLen;
          const minYIn = WALL_IN;
          const maxYIn = block.widthIn - WALL_IN - cavWid;

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

    prevCavityCountRef.current = cavities.length;
  }, [cavities, block.lengthIn, block.widthIn, updateCavityPosition]);

  // Handle edits to the active layer's thickness
  const handleActiveLayerThicknessChange = (value: string) => {
    if (!activeLayer) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setLayerThicknessIn(activeLayer.id, num);
  };

  const [zoom, setZoom] = React.useState(1);
  const [croppedCorners, setCroppedCorners] = React.useState(false);
  const [notes, setNotes] = React.useState(initialNotes || "");
  const [applyStatus, setApplyStatus] = React.useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [qty, setQty] = React.useState<number | "">(
    initialQty != null ? initialQty : "",
  );

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

      const sku = kind === "RSC" ? boxSuggest.bestRsc?.sku : boxSuggest.bestMailer?.sku;

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
    [boxSuggest.bestRsc, boxSuggest.bestMailer, quoteNo, qty],
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
        selectedCavity.cornerRadiusIn != null ? String(selectedCavity.cornerRadiusIn) : "",
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

  // Center selected cavity (fixes missing symbol compile error)
  const handleCenterSelectedCavity = React.useCallback(() => {
    if (!selectedCavity) return;

    const L = Number(block.lengthIn) || 0;
    const W = Number(block.widthIn) || 0;
    if (!(L > 0) || !(W > 0)) return;

    const cavLen = Number(selectedCavity.lengthIn) || 0;
    const cavWid = Number(selectedCavity.widthIn) || 0;

    const clamp = (v: number, min: number, max: number) =>
      v < min ? min : v > max ? max : v;

    const xInRaw = (L - cavLen) / 2;
    const yInRaw = (W - cavWid) / 2;

    const minX = WALL_IN;
    const maxX = L - WALL_IN - cavLen;
    const minY = WALL_IN;
    const maxY = W - WALL_IN - cavWid;

    const xIn = clamp(xInRaw, Math.min(minX, maxX), Math.max(minX, maxX));
    const yIn = clamp(yInRaw, Math.min(minY, maxY), Math.max(minY, maxY));

    const xNorm = xIn / L;
    const yNorm = yIn / W;

    updateCavityPosition(selectedCavity.id, xNorm, yNorm);
  }, [selectedCavity, block.lengthIn, block.widthIn, updateCavityPosition]);

  // Load material options for selector
  React.useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const res = await fetch("/api/materials/options", { cache: "no-store" });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`materials/options ${res.status} ${txt}`.trim());
        }
        const data = await res.json();

        const options: MaterialOption[] = Array.isArray(data?.options)
          ? data.options
          : Array.isArray(data)
          ? data
          : [];

        if (!cancelled) {
          setMaterials(options);
          setMaterialsLoading(false);

          // If we have an initial material id but it's not in the list, clear it
          if (
            selectedMaterialId != null &&
            !options.some((m) => Number(m.id) === Number(selectedMaterialId))
          ) {
            setSelectedMaterialId(null);
          }
        }
      } catch (err: any) {
        console.error("Failed to load materials options:", err);
        if (!cancelled) {
          setMaterials([]);
          setMaterialsLoading(false);
          setMaterialsError(err?.message || "Failed to load materials.");
        }
      }
    }

    loadMaterials();
    return () => {
      cancelled = true;
    };
  }, [selectedMaterialId]);

  // Box suggester: compute best cartons from current layout + qty
  const runBoxSuggest = React.useCallback(async () => {
    try {
      setBoxSuggest((prev) => ({ ...prev, loading: true, error: null }));

      const numericQty =
        typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : 1;

      // Foam outside size is: block length/width with walls + cavities arrangement already included in layout
      // Here, we use block footprint and total stack thickness as "foam size"
      const payload = {
        quote_no: quoteNo,
        qty: numericQty,
        foam: {
          length_in: Number(block.lengthIn) || 0,
          width_in: Number(block.widthIn) || 0,
          height_in: Number(totalStackThicknessIn) || 0,
        },
        padding: {
          wall_in: WALL_IN,
        },
      };

      const res = await fetch("/api/boxes/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res
        .json()
        .catch(() => ({ ok: false, error: "non_json_response" }));

      if (!res.ok || !data?.ok) {
        const msg =
          data?.error ||
          data?.message ||
          `boxes/suggest failed (${res.status})`;
        setBoxSuggest({ loading: false, error: msg, bestRsc: null, bestMailer: null });
        return;
      }

      const bestRsc = data?.bestRsc ?? null;
      const bestMailer = data?.bestMailer ?? null;

      setBoxSuggest({
        loading: false,
        error: null,
        bestRsc,
        bestMailer,
      });
    } catch (err: any) {
      console.error("Box suggest failed:", err);
      setBoxSuggest({
        loading: false,
        error: err?.message || "Box suggestion failed.",
        bestRsc: null,
        bestMailer: null,
      });
    }
  }, [qty, quoteNo, block.lengthIn, block.widthIn, totalStackThicknessIn]);

  // Re-run box suggest when key inputs change (debounced)
  React.useEffect(() => {
    const t = setTimeout(() => {
      runBoxSuggest();
    }, 350);
    return () => clearTimeout(t);
  }, [runBoxSuggest]);
  const handleApplyToQuote = React.useCallback(async () => {
    if (!hasRealQuoteNo) {
      alert("This is example mode (no quote_no). Open from an email link or provide ?quote_no=...");
      return;
    }

    if (!selectedMaterialId) {
      alert("Please select a material before applying to quote.");
      return;
    }

    const numericQty =
      typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : null;

    setApplyStatus("saving");

    // Build layout payload. For multi-layer, include stack and activeLayerId if present.
    const layoutPayload: any = {
      ...layout,
    };

    // Ensure stack thickness values are present (avoid missing thickness when applying)
    if (Array.isArray((layoutPayload as any).stack) && (layoutPayload as any).stack.length > 0) {
      (layoutPayload as any).stack = (layoutPayload as any).stack.map((l: any) => ({
        ...l,
        thicknessIn: Number(l.thicknessIn) || blockThicknessIn,
      }));
      (layoutPayload as any).activeLayerId =
        (layoutPayload as any).activeLayerId || (layoutPayload as any).stack[0]?.id || null;
    }

    const payload = {
      quoteNo,
      materialId: selectedMaterialId,
      qty: numericQty,
      notes: notes || "",
      layout: layoutPayload,
      // NOTE: keep customer fields here for future hook-up
      customer: {
        name: customerName || "",
        email: customerEmail || "",
        company: customerCompany || "",
        phone: customerPhone || "",
      },
    };

    try {
      const res = await fetch("/api/quote/layout/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res
        .json()
        .catch(() => ({ ok: false, error: "non_json_response" }));

      if (!res.ok || !data?.ok) {
        console.error("Apply failed:", res.status, data);
        setApplyStatus("error");
        return;
      }

      setApplyStatus("done");

      // After apply, push back to quote page (keep current behavior)
      router.push(`/quote?quote_no=${encodeURIComponent(quoteNo)}`);
    } catch (err) {
      console.error("Apply error:", err);
      setApplyStatus("error");
    } finally {
      setTimeout(() => setApplyStatus("idle"), 1200);
    }
  }, [
    hasRealQuoteNo,
    selectedMaterialId,
    qty,
    notes,
    layout,
    quoteNo,
    router,
    customerName,
    customerEmail,
    customerCompany,
    customerPhone,
    blockThicknessIn,
  ]);

  const handleExportDxf = React.useCallback(async () => {
    if (!hasRealQuoteNo) {
      alert("Example mode - export needs a real quote.");
      return;
    }
    try {
      const res = await fetch(
        `/api/quote/layout/export/dxf?quote_no=${encodeURIComponent(quoteNo)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`DXF export failed ${res.status} ${txt}`.trim());
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quoteNo}-layout.dxf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "DXF export failed.");
    }
  }, [hasRealQuoteNo, quoteNo]);

  const handleExportStep = React.useCallback(async () => {
    if (!hasRealQuoteNo) {
      alert("Example mode - export needs a real quote.");
      return;
    }
    try {
      const res = await fetch(
        `/api/quote/layout/export/step?quote_no=${encodeURIComponent(quoteNo)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`STEP export failed ${res.status} ${txt}`.trim());
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quoteNo}-layout.step`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "STEP export failed.");
    }
  }, [hasRealQuoteNo, quoteNo]);

  const fmtIn = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    return String(n);
  };

  const activeThickness =
    activeLayer && stack && stack.length > 0 ? getLayerThickness(activeLayer.id) : blockThicknessIn;

  // Simple derived metrics
  const outsideLengthIn = snapInches((Number(block.lengthIn) || 0) + 2 * WALL_IN);
  const outsideWidthIn = snapInches((Number(block.widthIn) || 0) + 2 * WALL_IN);
  const outsideHeightIn = snapInches((Number(totalStackThicknessIn) || 0) + 0); // height is stack thickness

  // For display: count cavities on active layer
  const cavityCount = cavities.length;

  const showApplyDone = applyStatus === "done";
  const showApplySaving = applyStatus === "saving";
  const showApplyError = applyStatus === "error";

  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),transparent_60%),radial-gradient(circle_at_bottom,_rgba(37,99,235,0.12),transparent_60%)] text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/85 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <div className="text-sm text-slate-300">Layout Editor</div>
            <div className="text-lg font-semibold tracking-tight">{quoteNo}</div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-sm"
              onClick={() => router.push(`/quote?quote_no=${encodeURIComponent(quoteNo)}`)}
            >
              Back to Quote
            </button>

            <button
              className="px-3 py-2 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-sm"
              onClick={handleExportDxf}
              disabled={!hasRealQuoteNo}
              title={!hasRealQuoteNo ? "Requires a real quote_no" : "Export DXF"}
            >
              Export DXF
            </button>

            <button
              className="px-3 py-2 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-sm"
              onClick={handleExportStep}
              disabled={!hasRealQuoteNo}
              title={!hasRealQuoteNo ? "Requires a real quote_no" : "Export STEP"}
            >
              Export STEP
            </button>

            <button
              className={`px-3 py-2 rounded-lg border text-sm ${
                showApplyDone
                  ? "border-emerald-500/60 bg-emerald-500/15"
                  : showApplyError
                  ? "border-rose-500/60 bg-rose-500/15"
                  : "border-sky-500/60 bg-sky-500/15 hover:bg-sky-500/20"
              }`}
              onClick={handleApplyToQuote}
              disabled={showApplySaving}
              title="Save layout and apply to quote"
            >
              {showApplySaving
                ? "Applying..."
                : showApplyDone
                ? "Applied ✓"
                : showApplyError
                ? "Error — Retry"
                : "Apply to Quote"}
            </button>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="max-w-[1400px] mx-auto px-5 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">Block (L×W×T)</div>
              <div className="text-sm">
                {fmtIn(block.lengthIn)}×{fmtIn(block.widthIn)}×{fmtIn(block.thicknessIn)} in
              </div>
            </div>

            <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">Outside (L×W×H)</div>
              <div className="text-sm">
                {fmtIn(outsideLengthIn)}×{fmtIn(outsideWidthIn)}×{fmtIn(outsideHeightIn)} in
              </div>
            </div>

            <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">Layers</div>
              <div className="text-sm">{layers ? layers.length : 1}</div>
            </div>

            <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">Active Layer</div>
              <div className="text-sm">{activeLayerLabel || "—"}</div>
            </div>

            <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">Active Thickness</div>
              <div className="text-sm">{fmtIn(activeThickness)} in</div>
            </div>

            <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">Cavities (active)</div>
              <div className="text-sm">{cavityCount}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Body: three-column layout */}
      <div className="max-w-[1400px] mx-auto p-5">
        <div className="flex flex-row gap-5 min-h-[620px]">
          {/* LEFT: Cavity palette + material + cartons + notes */}
          <aside className="w-52 shrink-0 flex flex-col gap-3">
            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="text-sm font-semibold mb-2">Cavities</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="px-2 py-2 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-sm"
                  onClick={() =>
                    addCavity("rect", {
                      lengthIn: 2,
                      widthIn: 2,
                      depthIn: 1,
                      cornerRadiusIn: 0,
                    })
                  }
                >
                  + Rect
                </button>
                <button
                  className="px-2 py-2 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-sm"
                  onClick={() =>
                    addCavity("circle", {
                      lengthIn: 2,
                      widthIn: 2,
                      depthIn: 1,
                      cornerRadiusIn: 0,
                    })
                  }
                >
                  + Circle
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-400">
                New cavities are added to the <span className="text-slate-200">active layer</span>.
              </div>
            </section>

            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="text-sm font-semibold mb-2">Material</div>

              {materialsLoading ? (
                <div className="text-xs text-slate-400">Loading materials…</div>
              ) : materialsError ? (
                <div className="text-xs text-rose-300">{materialsError}</div>
              ) : (
                <select
                  className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                  value={selectedMaterialId ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v <= 0) {
                      setSelectedMaterialId(null);
                    } else {
                      setSelectedMaterialId(v);
                    }
                  }}
                >
                  <option value="">Select material…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-slate-400">Qty</div>
                  <input
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                    value={qty}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (!v) return setQty("");
                      const n = Number(v);
                      if (!Number.isFinite(n) || n <= 0) return;
                      setQty(Math.floor(n));
                    }}
                    placeholder="Qty"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Zoom</div>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={croppedCorners}
                  onChange={(e) => setCroppedCorners(e.target.checked)}
                />
                Cropped corners
              </label>
            </section>

            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="text-sm font-semibold mb-2">Notes</div>
              <textarea
                className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm min-h-[120px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special instructions, labels, loose parts, etc…"
              />
              <div className="mt-2 text-[11px] text-slate-400">
                Saved with the quote when you click <span className="text-slate-200">Apply to Quote</span>.
              </div>
            </section>

            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Carton suggestions</div>
                {boxSuggest.loading ? (
                  <span className="text-[11px] text-slate-400">Loading…</span>
                ) : null}
              </div>

              {boxSuggest.error ? (
                <div className="text-xs text-rose-300">{boxSuggest.error}</div>
              ) : (
                <div className="space-y-2 text-xs">
                  {boxSuggest.bestRsc ? (
                    <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-200">Best RSC</div>
                        <div className="font-mono text-sky-200">{boxSuggest.bestRsc.sku}</div>
                      </div>
                      <div className="text-slate-300 mt-1">{boxSuggest.bestRsc.description}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Inside:{" "}
                        <span className="font-mono text-slate-200">
                          {boxSuggest.bestRsc.inside_length_in}" × {boxSuggest.bestRsc.inside_width_in}" ×{" "}
                          {boxSuggest.bestRsc.inside_height_in}"
                        </span>
                        {" · "}
                        Fit: <span className="font-mono text-slate-200">{boxSuggest.bestRsc.fit_score}</span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          className="px-2 py-1 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-xs"
                          onClick={() => handlePickCarton("RSC")}
                        >
                          Add to quote
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400">No RSC suggestion.</div>
                  )}

                  {boxSuggest.bestMailer ? (
                    <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-200">Best Mailer</div>
                        <div className="font-mono text-sky-200">{boxSuggest.bestMailer.sku}</div>
                      </div>
                      <div className="text-slate-300 mt-1">{boxSuggest.bestMailer.description}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Inside:{" "}
                        <span className="font-mono text-slate-200">
                          {boxSuggest.bestMailer.inside_length_in}" × {boxSuggest.bestMailer.inside_width_in}" ×{" "}
                          {boxSuggest.bestMailer.inside_height_in}"
                        </span>
                        {" · "}
                        Fit: <span className="font-mono text-slate-200">{boxSuggest.bestMailer.fit_score}</span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          className="px-2 py-1 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-xs"
                          onClick={() => handlePickCarton("MAILER")}
                        >
                          Add to quote
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400">No mailer suggestion.</div>
                  )}

                  <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-800/60">
                    Uses footprint + stack depth + qty.
                  </div>
                </div>
              )}
            </section>
          </aside>

          {/* CENTER: Big visualizer */}
          <section className="flex-1 flex flex-col gap-3">
            <div className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Foam layout preview</div>
                  <div className="text-xs text-slate-400">
                    Drag cavities to move. Use the bottom-right handle to resize.
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Length</span>
                  <input
                    type="number"
                    step={0.125}
                    className="w-20 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-1"
                    value={Number(block.lengthIn) || 0}
                    onChange={(e) => updateBlockDims({ lengthIn: snapInches(Number(e.target.value) || 0) })}
                  />
                  <span className="text-slate-400">Width</span>
                  <input
                    type="number"
                    step={0.125}
                    className="w-20 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-1"
                    value={Number(block.widthIn) || 0}
                    onChange={(e) => updateBlockDims({ widthIn: snapInches(Number(e.target.value) || 0) })}
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 rounded-2xl border border-slate-800/80 bg-slate-950/70 overflow-hidden shadow-[0_22px_55px_rgba(15,23,42,0.95)]">
              <div className="p-3 overflow-auto">
                <InteractiveCanvas
                  layout={layout as any}
                  selectedId={selectedId}
                  selectAction={selectCavity}
                  moveAction={(id: string, xNorm: number, yNorm: number) => {
                    selectCavity(id);
                    updateCavityPosition(id, xNorm, yNorm);
                  }}
                  resizeAction={(id: string, lengthIn: number, widthIn: number) =>
                    updateCavityDims(id, { lengthIn, widthIn })
                  }
                  zoom={zoom}
                  croppedCorners={croppedCorners}
                />
              </div>
            </div>
          </section>

          {/* RIGHT: inspector */}
          <aside className="w-80 min-w-[300px] shrink-0 flex flex-col gap-3">
            {/* Customer */}
            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="text-sm font-semibold mb-2">Customer</div>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs">
                  <div className="text-[11px] text-slate-400 mb-1">Name</div>
                  <input
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                  />
                </label>
                <label className="text-xs">
                  <div className="text-[11px] text-slate-400 mb-1">Email</div>
                  <input
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="email@company.com"
                  />
                </label>
                <label className="text-xs">
                  <div className="text-[11px] text-slate-400 mb-1">Company</div>
                  <input
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                    value={customerCompany}
                    onChange={(e) => setCustomerCompany(e.target.value)}
                    placeholder="Company (optional)"
                  />
                </label>
                <label className="text-xs">
                  <div className="text-[11px] text-slate-400 mb-1">Phone</div>
                  <input
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone (optional)"
                  />
                </label>
              </div>
            </section>

            {/* Layers */}
            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Layers</div>
                <button
                  className="px-2 py-1 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-xs"
                  onClick={() => addLayer?.()}
                >
                  + Add
                </button>
              </div>

              {layers && layers.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-auto pr-1">
                  {layers.map((l) => {
                    const isActive = (activeLayerId || layers[0].id) === l.id;
                    const t = getLayerThickness(l.id);

                    return (
                      <div
                        key={l.id}
                        className={`rounded-lg border p-2 ${
                          isActive
                            ? "border-sky-500/70 bg-sky-500/10"
                            : "border-slate-800/70 bg-slate-950/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            className={`text-left text-sm font-medium ${
                              isActive ? "text-sky-100" : "text-slate-200"
                            }`}
                            onClick={() => setActiveLayerId?.(l.id)}
                            type="button"
                          >
                            {l.label}
                          </button>

                          {layers.length > 1 ? (
                            <button
                              className="text-xs text-rose-300 hover:text-rose-200"
                              onClick={() => deleteLayer?.(l.id)}
                              type="button"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="text-[11px] text-slate-400">Thickness (in)</div>
                          <input
                            type="number"
                            step={0.125}
                            className="w-24 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-1 text-sm"
                            value={t}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n) || n <= 0) return;
                              setLayerThicknessIn(l.id, n);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-400">Single-layer layout.</div>
              )}
            </section>

            {/* Cavities list */}
            <section className="rounded-xl border border-slate-800/70 bg-slate-950/70 p-3 flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Cavities</div>
                <div className="text-xs text-slate-400">
                  {activeLayerLabel ? `Active: ${activeLayerLabel}` : ""}
                </div>
              </div>

              {cavities.length === 0 ? (
                <div className="mt-3 text-xs text-slate-400">No cavities on this layer.</div>
              ) : (
                <div className="mt-3 space-y-1.5 max-h-56 overflow-auto pr-1">
                  {cavities.map((c) => {
                    const isSel = c.id === selectedId;
                    return (
                      <div
                        key={c.id}
                        className={`rounded-lg border px-2 py-2 flex items-center justify-between gap-2 ${
                          isSel
                            ? "border-sky-500/70 bg-sky-500/10"
                            : "border-slate-800/70 bg-slate-950/50"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex-1 text-left text-sm"
                          onClick={() => selectCavity(isSel ? null : c.id)}
                        >
                          <div className="font-medium text-slate-200">{c.label}</div>
                          <div className="text-[11px] text-slate-400">
                            {Number(c.lengthIn) || 0}×{Number(c.widthIn) || 0}×{Number((c as any).depthIn) || 0} in
                          </div>
                        </button>
                        <button
                          type="button"
                          className="text-xs text-rose-300 hover:text-rose-200"
                          onClick={() => deleteCavity(c.id)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Selected cavity editor */}
              {selectedCavity ? (
                <div className="mt-3 pt-3 border-t border-slate-800/70">
                  <div className="text-sm font-semibold mb-2">Selected cavity</div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <div className="text-[11px] text-slate-400 mb-1">Length</div>
                      <input
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                        value={cavityInputs.length}
                        onChange={(e) => setCavityInputs((p) => ({ ...p, length: e.target.value }))}
                        onBlur={() => commitCavityField("length")}
                      />
                    </label>

                    <label className="text-xs">
                      <div className="text-[11px] text-slate-400 mb-1">Width</div>
                      <input
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                        value={cavityInputs.width}
                        onChange={(e) => setCavityInputs((p) => ({ ...p, width: e.target.value }))}
                        onBlur={() => commitCavityField("width")}
                      />
                    </label>

                    <label className="text-xs">
                      <div className="text-[11px] text-slate-400 mb-1">Depth</div>
                      <input
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                        value={cavityInputs.depth}
                        onChange={(e) => setCavityInputs((p) => ({ ...p, depth: e.target.value }))}
                        onBlur={() => commitCavityField("depth")}
                      />
                    </label>

                    <label className="text-xs">
                      <div className="text-[11px] text-slate-400 mb-1">Corner radius</div>
                      <input
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-2 py-2 text-sm"
                        value={cavityInputs.cornerRadius}
                        onChange={(e) => setCavityInputs((p) => ({ ...p, cornerRadius: e.target.value }))}
                        onBlur={() => commitCavityField("cornerRadius")}
                      />
                    </label>
                  </div>

                  <button
                    className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-900 text-sm"
                    onClick={handleCenterSelectedCavity}
                    type="button"
                  >
                    Center cavity
                  </button>
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ---------- SVG export helper ---------- */

function buildSvgFromLayout(
  layout: LayoutModel,
  meta?: { notes?: string; materialLabel?: string | null },
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

    if ((c as any).shape === "circle") {
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
    } else {
      cavects.push(
        [
          `<g>`,
          `  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cavW.toFixed(
            2,
          )}" height="${cavH.toFixed(2)}" rx="0" ry="0" fill="none" stroke="#111827" stroke-width="1" />`,
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

  svgParts.push(
    `  <rect x="${blockX.toFixed(2)}" y="${blockY.toFixed(2)}" width="${blockW.toFixed(
      2,
    )}" height="${blockH.toFixed(2)}" rx="0" ry="0" fill="#e5e7eb" stroke="#111827" stroke-width="2" />`,
  );

  if (cavRects) {
    svgParts.push(cavRects);
  }

  if (metaSection) {
    svgParts.push(metaSection);
  }

  svgParts.push(`</svg>`);

  return svgParts.join("\n");
}
