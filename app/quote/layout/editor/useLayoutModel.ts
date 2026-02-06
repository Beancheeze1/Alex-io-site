// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// HARDENED:
//  - Infers layers + thickness from email intent on first open
//  - Single source of truth for cavities = stack[layer].cavities
//  - layout.cavities ALWAYS mirrors active layer (never seeded)
//  - Seeded cavities use stable ids (seed-cav-*) to prevent phantom duplication
//  - De-dupes cavities defensively when mirroring active layer
//  - Mirrors active layer thickness into layout.block.thicknessIn for UI controls
//  - Legacy layouts normalized exactly once
//  - Path A safe
//  - HARDENING: ensure cavity x/y are always finite so drag can never teleport to (0,0)
//  - NEW HARDENING (12/19): NEVER turn invalid x/y into 0 (upper-left teleport).
//    If an invalid coordinate reaches updateCavityPosition(), we keep the prior value.
//
// NEW (Path A, additive):
//  - Per-layer crop-corners toggle persisted on LayoutLayer.cropCorners
//  - Hook exposes setLayerCropCorners(id, value)
//  - Normalization preserves cropCorners if already present
//
// STEP 4 SAFETY RAILS (12/27):
//  - Preserve unknown/future fields on LayoutModel during normalization.
//    This ensures Advanced-only metadata can round-trip through the editor
//    without being silently dropped, even when the user is in Basic mode.

"use client";

import { useState, useCallback, useEffect, useRef } from "react";

import type {
  BlockDims,
  LayoutModel,
  Cavity,
  CavityShape,
  LayoutLayer,
} from "./layoutTypes";

/* ================= state ================= */

type LayoutState = {
  layout: LayoutModel & { stack: LayoutLayer[] };
  activeLayerId: string;
};

export type UseLayoutModelResult = {
  layout: LayoutModel & { stack: LayoutLayer[] };

  editorMode: "basic" | "advanced";

  selectedIds: string[];
  selectedId: string | null;

  activeLayerId: string;

  selectCavity: (id: string | null, opts?: { additive?: boolean }) => void;
  setActiveLayerId: (id: string) => void;

  setEditorMode: (mode: "basic" | "advanced") => void;
  setLayerCropCorners: (layerId: string, cropCorners: boolean) => void;
  setLayerRoundCorners: (layerId: string, roundCorners: boolean) => void;
  setLayerRoundRadiusIn: (layerId: string, roundRadiusIn: number) => void;

  updateCavityPosition: (id: string, x: number, y: number) => void;
  updateBlockDims: (patch: Partial<BlockDims>) => void;
  updateCavityDims: (id: string, patch: Partial<Cavity>) => void;

  addCavity: (shape: CavityShape, size?: any) => void;
  deleteCavity: (id: string) => void;

  addLayer: () => void;
  renameLayer: (id: string, label: string) => void;
  deleteLayer: (id: string) => void;

  importLayerFromSeed: (
    seed: LayoutModel,
    opts?: { mode?: "append" | "replace"; label?: string; targetLayerId?: string | null },
  ) => void;
};

const DEFAULT_ROUND_RADIUS_IN = 0.25;

export function useLayoutModel(initial: LayoutModel): UseLayoutModelResult {
  const [state, setState] = useState<LayoutState>(() =>
    normalizeInitialLayout(initial),
  );
const didInitActiveLayerRef = useRef(false);


  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { layout, activeLayerId } = state;
  const selectedId = selectedIds[0] ?? null;

  // ============================
  // DEBUG (log-only): gate by ?debug_xy=1
  // ============================
  const debugXY =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug_xy") === "1";

  const lastDebugSigRef = useRef<string>("");

  useEffect(() => {
    if (!debugXY) return;

    const active =
      layout.stack.find((l) => l.id === activeLayerId) ?? layout.stack[0] ?? null;

    const stackFirst = active?.cavities?.[0] ?? null;
    const mirroredFirst = (layout as any)?.cavities?.[0] ?? null;

    const sig = JSON.stringify({
      activeLayerId,
      activeExists: !!active,
      stackFirst: stackFirst
        ? { id: stackFirst.id, x: (stackFirst as any).x, y: (stackFirst as any).y }
        : null,
      mirroredFirst: mirroredFirst
        ? {
            id: (mirroredFirst as any).id,
            x: (mirroredFirst as any).x,
            y: (mirroredFirst as any).y,
          }
        : null,
      stackCount: active?.cavities?.length ?? 0,
      mirroredCount: (layout as any)?.cavities?.length ?? 0,
    });

    if (sig === lastDebugSigRef.current) return;
    lastDebugSigRef.current = sig;

    // eslint-disable-next-line no-console
    console.log("[debug_xy][model] active + first cavity snapshot", {
      activeLayerId,
      activeLayerResolved: active?.id ?? null,
      stackFirst: stackFirst
        ? { id: stackFirst.id, x: (stackFirst as any).x, y: (stackFirst as any).y }
        : null,
      mirroredFirst: mirroredFirst
        ? {
            id: (mirroredFirst as any).id,
            x: (mirroredFirst as any).x,
            y: (mirroredFirst as any).y,
          }
        : null,
      stackCount: active?.cavities?.length ?? 0,
      mirroredCount: (layout as any)?.cavities?.length ?? 0,
    });
  }, [debugXY, activeLayerId, layout]);

  // ✅ Path A: one-time hydration sync
  // On first render, layout.cavities may be empty even though stack[active].cavities is seeded.
  // Clicking layers calls setActiveLayerId() which mirrors stack -> layout.cavities.
  // This effect does that mirror once so seeded cavities are visible immediately.
  useEffect(() => {
  if (didInitActiveLayerRef.current) return;
  didInitActiveLayerRef.current = true;

  setState((prev) => {
    if (!prev.activeLayerId) return prev;
    if ((prev.layout.cavities?.length ?? 0) > 0) return prev;

    const active =
      prev.layout.stack.find((l) => l.id === prev.activeLayerId) ??
      prev.layout.stack[0];

    if (!active) return prev;

    return {
      layout: {
        ...prev.layout,
        cavities: dedupeCavities(active.cavities),
      },
      activeLayerId: active.id,
    };
  });
}, []);


  /* ================= selection ================= */

  const selectCavity = useCallback(
    (id: string | null, opts?: { additive?: boolean }) => {
      if (!id) {
        setSelectedIds([]);
        return;
      }

      const additive = !!opts?.additive;

      setSelectedIds((prev) => {
        if (!additive) return [id];
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length === 0) return [id];
        if (prev.length === 1) return [prev[0], id];
        return [prev[0], id];
      });
    },
    [],
  );

  /* ================= ACTIVE LAYER (FIXED) ================= */

  const setActiveLayerId = useCallback(
    (id: string) => {
      setState((prev) => {
        const layer =
          prev.layout.stack.find((l) => l.id === id) ?? prev.layout.stack[0];
        const mirrored = dedupeCavities(layer.cavities);

        return {
          layout: {
            ...prev.layout,
            block: {
              ...prev.layout.block,
              thicknessIn: safeInch(layer.thicknessIn, 0.5),
            },
            cavities: [...mirrored], // ✅ mirror ONLY active layer
          },
          activeLayerId: layer.id,
        };
      });

      // ✅ FIX: DO NOT blindly clear selection
      // Only keep selections that still exist in the active layer
      setSelectedIds((prev) => {
        if (!prev.length) return prev;

        const active =
          state.layout.stack.find((l) => l.id === id) ?? state.layout.stack[0];

        const valid = new Set(active.cavities.map((c) => c.id));
        return prev.filter((cid) => valid.has(cid));
      });
    },
    [state.layout.stack],
  );

  /* ================= editor mode ================= */

  const setEditorMode = useCallback((mode: "basic" | "advanced") => {
    setState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        editorMode: mode,
      },
    }));
  }, []);

  const setLayerCropCorners = useCallback(
    (layerId: string, cropCorners: boolean) => {
      setState((prev) => ({
        ...prev,
        layout: {
          ...prev.layout,
          stack: prev.layout.stack.map((l) =>
            l.id === layerId ? { ...l, cropCorners: !!cropCorners } : l,
          ),
        },
      }));
    },
    [],
  );

  const setLayerRoundCorners = useCallback(
    (layerId: string, roundCorners: boolean) => {
      setState((prev) => ({
        ...prev,
        layout: {
          ...prev.layout,
          stack: prev.layout.stack.map((l) => {
            if (l.id !== layerId) return l;
            const nextRadius = Number(l.roundRadiusIn);
            const radius =
              Number.isFinite(nextRadius) && nextRadius > 0
                ? nextRadius
                : DEFAULT_ROUND_RADIUS_IN;
            return {
              ...l,
              roundCorners: !!roundCorners,
              roundRadiusIn: radius,
            };
          }),
        },
      }));
    },
    [],
  );

  const setLayerRoundRadiusIn = useCallback(
    (layerId: string, roundRadiusIn: number) => {
      setState((prev) => ({
        ...prev,
        layout: {
          ...prev.layout,
          stack: prev.layout.stack.map((l) =>
            l.id === layerId
              ? { ...l, roundRadiusIn: roundRadiusIn }
              : l,
          ),
        },
      }));
    },
    [],
  );

  /* ================= cavity + block updates ================= */

  const updateCavityPosition = useCallback((id: string, x: number, y: number) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((layer) =>
        layer.id !== prev.activeLayerId
          ? layer
          : {
              ...layer,
              cavities: layer.cavities.map((c) => {
                if (c.id !== id) return c;
                
                const newX = clamp01OrKeep(x, c.x);
                const newY = clamp01OrKeep(y, c.y);
                
                // For poly shapes, translate the points array
                if ((c as any).shape === "poly" && Array.isArray((c as any).points)) {
                  const oldX = c.x;
                  const oldY = c.y;
                  const deltaX = newX - oldX;
                  const deltaY = newY - oldY;
                  
                  const translatedPoints = ((c as any).points as Array<{x: number; y: number}>).map(pt => ({
                    x: Math.max(0, Math.min(1, pt.x + deltaX)),
                    y: Math.max(0, Math.min(1, pt.y + deltaY)),
                  }));
                  
                  return { ...c, x: newX, y: newY, points: translatedPoints };
                }
                
                // For other shapes, just update x and y
                return { ...c, x: newX, y: newY };
              }),
            },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: dedupeCavities(active.cavities),
        },
        activeLayerId: active.id,
      };
    });

    // ✅ STICKY SELECTION (Path A):
    // Ensure the cavity being moved remains selected.
    // Preserves 2-select if this id is already in the selection.
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev;
      return [id];
    });
  }, []);

  const updateBlockDims = useCallback((patch: Partial<BlockDims>) => {
    setState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        block: { ...prev.layout.block, ...normalizeBlockPatch(patch) },
      },
    }));
  }, []);

  const updateCavityDims = useCallback((id: string, patch: Partial<Cavity>) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((layer) =>
        layer.id !== prev.activeLayerId
          ? layer
          : {
              ...layer,
              cavities: layer.cavities.map((c) => {
                if (c.id !== id) return c;

                const next = { ...c, ...normalizeCavityPatch(patch) } as Cavity;

                // ✅ Path-A: keep sidebar labels in sync with live dims
                // Only auto-generate when the user didn't explicitly set a label in this patch.
                const patchTouchesGeometry =
                  (patch as any).shape != null ||
                  (patch as any).lengthIn != null ||
                  (patch as any).widthIn != null ||
                  (patch as any).depthIn != null ||
                  (patch as any).cornerRadiusIn != null ||
                  (patch as any).corner_radius_in != null;

                if ((patch as any).label == null && patchTouchesGeometry) {
                  (next as any).label = formatCavityLabel(next);
                }

                return next;
              }),
            },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: dedupeCavities(active.cavities),
        },
        activeLayerId: active.id,
      };
    });

    // ✅ STICKY SELECTION (Path A):
    // Ensure the cavity being resized/edited remains selected.
    // Preserves 2-select if this id is already in the selection.
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev;
      return [id];
    });
  }, []);

  /* ================= cavity + layer ops ================= */

  const addCavity = useCallback((shape: CavityShape, size: any) => {
    let newId: string | null = null;

    setState((prev) => {
      const id = `cav-${nextCavityNumber(prev.layout.stack)}`;
      newId = id;

      const cavity: Cavity = {
        id,
        shape,
        lengthIn: safeInch(size?.lengthIn ?? 2, 0.5),
        widthIn: safeInch(size?.widthIn ?? 2, 0.5),
        depthIn: safeInch(size?.depthIn ?? 1, 0.5),
        cornerRadiusIn: safeInch(size?.cornerRadiusIn ?? 0, 0),
        x: 0.2,
        y: 0.2,
        label: "",
      };

      const nextStack = prev.layout.stack.map((l) =>
        l.id !== prev.activeLayerId
          ? l
          : { ...l, cavities: [...l.cavities, cavity] },
      );

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: dedupeCavities(
            cavity
              ? [...nextStack.find((l) => l.id === prev.activeLayerId)!.cavities]
              : [],
          ),
        },
        activeLayerId: prev.activeLayerId,
      };
    });

    if (newId) setSelectedIds([newId]);
  }, []);

  const deleteCavity = useCallback((id: string) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((l) => ({
        ...l,
        cavities: l.cavities.filter((c) => c.id !== id),
      }));

      const active =
        nextStack.find((l) => l.id === prev.activeLayerId) ?? nextStack[0];

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: dedupeCavities(active.cavities),
        },
        activeLayerId: active.id,
      };
    });

    setSelectedIds((prev) => (prev.includes(id) ? [] : prev));
  }, []);

  const addLayer = useCallback(() => {
    setState((prev) => {
      const idx = prev.layout.stack.length + 1;
      const id = `layer-${idx}`;

      return {
        layout: {
          ...prev.layout,
          stack: [
            ...prev.layout.stack,
            {
              id,
              label: `Layer ${idx}`,
              thicknessIn: 1,
              cavities: [],
              cropCorners: false,
              roundCorners: false,
              roundRadiusIn: DEFAULT_ROUND_RADIUS_IN,
            },
          ],
          cavities: [],
        },
        activeLayerId: id,
      };
    });

    setSelectedIds([]);
  }, []);

  const renameLayer = useCallback((id: string, label: string) => {
    setState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        stack: prev.layout.stack.map((l) =>
          l.id === id ? { ...l, label: label.trim() || l.label } : l,
        ),
      },
    }));
  }, []);

  const deleteLayer = useCallback((id: string) => {
    setState((prev) => {
      if (prev.layout.stack.length <= 1) return prev;

      const nextStack = prev.layout.stack.filter((l) => l.id !== id);
      const active = nextStack[0];

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: dedupeCavities(active.cavities),
        },
        activeLayerId: active.id,
      };
    });

    setSelectedIds([]);
  }, []);

  const importLayerFromSeed = useCallback(
    (
      seed: LayoutModel,
      opts?: { mode?: "append" | "replace"; label?: string; targetLayerId?: string | null },
    ) => {
      const mode = opts?.mode === "append" ? "append" : "replace";
      const labelFromSeed = (opts?.label ?? "").trim();

      setState((prev) => {
        const seedBlock = (seed as any)?.block ?? {};
        const seedStack = Array.isArray((seed as any)?.stack) ? (seed as any).stack : [];
        const seedLayer = seedStack[0] ?? null;

        const seedCavsRaw = Array.isArray(seedLayer?.cavities)
          ? seedLayer.cavities
          : Array.isArray((seed as any)?.cavities)
          ? (seed as any).cavities
          : [];

        const thicknessIn = safeInch(
          seedLayer?.thicknessIn ?? seedBlock?.thicknessIn ?? prev.layout.block.thicknessIn ?? 1,
          0.5,
        );

        const remappedCavs = remapImportedCavities({
          seedCavs: seedCavsRaw,
          currentBlock: prev.layout.block,
          seedBlock,
          mode,
          startIndex: nextCavityNumber(prev.layout.stack),
        });

        const cavities = dedupeCavities(remappedCavs);

        if (mode === "append") {
          const idx = prev.layout.stack.length + 1;
          const id = `layer-${idx}`;
          const label = labelFromSeed || `Layer ${idx}`;

          const nextLayer: LayoutLayer = {
            id,
            label,
            thicknessIn,
            cavities,
            cropCorners: !!seedLayer?.cropCorners,
            roundCorners: false,
            roundRadiusIn: DEFAULT_ROUND_RADIUS_IN,
          };

          return {
            layout: {
              ...prev.layout,
              block: {
                ...prev.layout.block,
                thicknessIn,
              },
              stack: [...prev.layout.stack, nextLayer],
              cavities: [...cavities],
            },
            activeLayerId: id,
          };
        }

        const targetId =
          (opts?.targetLayerId && prev.layout.stack.find((l) => l.id === opts.targetLayerId)?.id) ??
          prev.activeLayerId ??
          prev.layout.stack[0]?.id;

        const target =
          prev.layout.stack.find((l) => l.id === targetId) ?? prev.layout.stack[0];

        const nextStack = prev.layout.stack.map((l) =>
          l.id === target.id
            ? {
                ...l,
                thicknessIn,
                cavities,
                cropCorners:
                  seedLayer?.cropCorners != null ? !!seedLayer.cropCorners : !!l.cropCorners,
                roundCorners: !!l.roundCorners,
                roundRadiusIn:
                  Number.isFinite(Number(l.roundRadiusIn)) && Number(l.roundRadiusIn) > 0
                    ? Number(l.roundRadiusIn)
                    : DEFAULT_ROUND_RADIUS_IN,
              }
            : l,
        );

        const nextBlock = {
          ...prev.layout.block,
          ...normalizeBlockPatch({
            lengthIn: seedBlock?.lengthIn,
            widthIn: seedBlock?.widthIn,
            thicknessIn,
            cornerStyle: seedBlock?.cornerStyle,
            chamferIn: seedBlock?.chamferIn,
          }),
        };

        return {
          layout: {
            ...prev.layout,
            block: nextBlock,
            stack: nextStack,
            cavities: [...cavities],
          },
          activeLayerId: target.id,
        };
      });

      setSelectedIds([]);
    },
    [],
  );

  return {
    layout,
    editorMode: layout.editorMode ?? "basic",

    selectedIds,
    selectedId,
    activeLayerId,

    selectCavity,
    setActiveLayerId,
    setEditorMode,
    setLayerCropCorners,

    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
    addLayer,
    renameLayer,
    deleteLayer,
    setLayerRoundCorners,
    setLayerRoundRadiusIn,
    importLayerFromSeed,
  };
}

/* ================= helpers ================= */

function normalizeInitialLayout(initial: LayoutModel): LayoutState {
  // STEP 4 SAFETY RAIL:
  // Preserve unknown / future LayoutModel fields so Advanced-only metadata can round-trip.
  // We normalize the fields we know, but we DO NOT drop additional keys.
  const { block: _b, cavities: _c, stack: _s, editorMode: _m, ...rest } =
    (initial as any) ?? {};

  // =========================================================
  // NEW (Path A): form seed alias normalization for qty + material
  //
  // Goal:
  //  - qty from the form URL must show up in whatever key the UI expects
  //  - foam from the form URL must show up in whatever key the UI expects
  //
  // We do NOT parse or guess families (PE vs EPE is protected).
  // We only mirror the raw string into a few safe carriers.
  // =========================================================
  {
    const src: any = (initial as any) ?? {};
    const r: any = rest as any;

    // ----- QTY -----
    // Accept qty / quantity; also seed quantities[] if UI uses a list.
    const qtyRaw =
      src.qty ?? src.quantity ?? r.qty ?? r.quantity ?? (r as any).qty_raw;

    const qtyNum = Number(qtyRaw);
    if (Number.isFinite(qtyNum) && qtyNum > 0) {
      if (r.qty == null) r.qty = qtyNum;
      if (r.quantity == null) r.quantity = qtyNum;

      // If UI expects an array of quantities and it's missing, seed it.
      if (!Array.isArray(r.quantities) || r.quantities.length === 0) {
        r.quantities = [qtyNum];
      }
    }

    // ----- MATERIAL (RAW TEXT) -----
    // Accept foam / material / material_text and mirror into common carriers.
    const foamRaw =
      src.foam ??
      src.material ??
      src.materialText ??
      src.material_text ??
      r.foam ??
      r.material ??
      r.materialText ??
      r.material_text;

    const foamText = String(foamRaw ?? "").trim();
    if (foamText) {
      if (r.foam == null) r.foam = foamText;
      if (r.material == null) r.material = foamText;
      if (r.materialText == null) r.materialText = foamText;
      if (r.material_text == null) r.material_text = foamText;

      // Extra safe carrier (some components use "material_name")
      if (r.material_name == null) r.material_name = foamText;
    }
  }

  const block = { ...(initial as any).block };

  const editorMode: "basic" | "advanced" =
    (initial as any).editorMode === "advanced" ? "advanced" : "basic";

  const hasStack =
    Array.isArray((initial as any).stack) && (initial as any).stack.length > 0;

  const cavsRaw = Array.isArray((initial as any).cavities)
    ? [...(initial as any).cavities]
    : [];

  // Accept both camelCase and snake_case carriers (page.tsx may map either way)
  const layerThicknessesRaw: any =
    (initial as any).layerThicknesses ??
    (initial as any).layer_thicknesses ??
    (initial as any).layers ??
    (initial as any).block?.layers;

  const layerThicknesses: number[] | null = Array.isArray(layerThicknessesRaw)
    ? layerThicknessesRaw
        .map((x: any) => Number(x))
        .filter((n: any) => Number.isFinite(n))
    : null;

  // Accept both camelCase and snake_case for target cavity layer
  const cavityLayerIndexRaw =
    (initial as any).layerCavityLayerIndex ??
    (initial as any).layer_cavity_layer_index;

  const cavityLayerIndex = Number(cavityLayerIndexRaw);
 const targetIdx1 =
  Number.isFinite(cavityLayerIndex) && cavityLayerIndex >= 1
    ? Math.floor(cavityLayerIndex)
    : 2;


  // ============================
  // NEW (Path A): layer-intent hydration when stack is missing
  // ============================
  if (!hasStack && layerThicknesses && layerThicknesses.length > 1) {
    const seededCavs =
      cavsRaw.length > 0
        ? dedupeCavities(
            cavsRaw.map((c: any, i: number) => ({
              ...c,
              id: String(c?.id ?? "").trim() || `seed-cav-${i + 1}`,
              x: clamp01OrPreserve(c?.x, (c as any)?.x, 0.2),
              y: clamp01OrPreserve(c?.y, (c as any)?.y, 0.2),
            })),
          )
        : [];

    const stack: LayoutLayer[] = layerThicknesses.map((t, i) => ({
      id: `layer-${i + 1}`,
      label: `Layer ${i + 1}`,
      thicknessIn: safeInch(t, 0.5),
      cavities: [],
      cropCorners: false,
      roundCorners: false,
      roundRadiusIn: DEFAULT_ROUND_RADIUS_IN,
    }));

    const targetIdx0 = Math.max(0, Math.min(stack.length - 1, targetIdx1 - 1));
    if (seededCavs.length) {
      stack[targetIdx0] = { ...stack[targetIdx0], cavities: seededCavs };
    }

    const active = stack[targetIdx0];
    const mirrored = dedupeCavities(active.cavities);

    return {
      layout: {
        ...rest,
        block: {
          ...block,
          thicknessIn: safeInch(active.thicknessIn ?? block.thicknessIn ?? 1, 0.5),
        },
        stack,
        cavities: [...mirrored],
        editorMode,
      },
      activeLayerId: active.id,
    };
  }

  // Trust pre-existing stack fully
  if (Array.isArray((initial as any).stack) && (initial as any).stack.length) {
    const seenIds = new Set<string>();

    let maxNum = 0;
    for (const l of (initial as any).stack) {
      for (const c of (l?.cavities ?? []) as Cavity[]) {
        const m = String((c as any)?.id ?? "").match(/(?:seed-cav-|cav-)(\d+)/);
        if (m) maxNum = Math.max(maxNum, Number(m[1]) || 0);
      }
    }

    let stack = (initial as any).stack.map((l: any) => {
      const cavsIn = (l.cavities ?? []) as Cavity[];

      const cavs = dedupeCavities(
        cavsIn.map((c: Cavity) => {
          const next = { ...c } as Cavity;

          (next as any).x = clamp01OrPreserve((next as any).x, (c as any)?.x, 0.2);
          (next as any).y = clamp01OrPreserve((next as any).y, (c as any)?.y, 0.2);

          let id = String((next as any).id ?? "").trim();
          if (!id || seenIds.has(id)) {
            maxNum += 1;
            id = `cav-${maxNum}`;
            (next as any).id = id;
          }

          seenIds.add(id);
          return next;
        }),
      );

      const roundRaw =
        (l as any).roundRadiusIn ??
        (l as any).round_radius_in ??
        (l as any).round_radius ??
        null;
      const roundNum = Number(roundRaw);
      const roundRadiusIn =
        Number.isFinite(roundNum) && roundNum > 0 ? roundNum : DEFAULT_ROUND_RADIUS_IN;

      return {
        id: l.id,
        label: l.label,
        thicknessIn: l.thicknessIn,
        cavities: cavs,
        cropCorners: !!(l as any).cropCorners,
        roundCorners: !!((l as any).roundCorners ?? (l as any).round_corners),
        roundRadiusIn,
      };
    }) as LayoutLayer[];

    // ----------------------------
    // NEW (Path A): Seed reconciliation when stack exists
    //
    // Goal: prevent “same seeded cavity appears on multiple layers” regressions.
    // Rules:
    // 1) If stack already contains any cavities anywhere, IGNORE top-level initial.cavities.
    // 2) If stack contains zero cavities, and top-level cavities exist, inject them ONLY
    //    into the intended target layer (layer_cavity_layer_index, default 1).
    // 3) If a target layer index was explicitly provided, remove ONLY obviously-seeded
    //    duplicates (seed-cav-*) across layers by signature, keeping the target copy.
    // ----------------------------
    const anyCavsInStack = stack.some((l) => (l.cavities?.length ?? 0) > 0);

    const targetIdx0 = Math.max(0, Math.min(stack.length - 1, targetIdx1 - 1));
    const targetLayerId = stack[targetIdx0]?.id ?? "layer-1";

    if (!anyCavsInStack && cavsRaw.length > 0) {
      const seededCavs = dedupeCavities(
        cavsRaw.map((c: any, i: number) => ({
          ...c,
          id: String(c?.id ?? "").trim() || `seed-cav-${i + 1}`,
          x: Number.isFinite(Number(c?.x)) ? clamp01(Number(c.x)) : undefined,
          y: Number.isFinite(Number(c?.y)) ? clamp01(Number(c.y)) : undefined,
        })),
      );

      stack = stack.map((l, i) =>
        i === targetIdx0 ? { ...l, cavities: seededCavs } : l,
      );
    }

    const hasExplicitTarget =
      Number.isFinite(cavityLayerIndex) && cavityLayerIndex >= 1;

    if (hasExplicitTarget) {
      const targetLayer = stack.find((l) => l.id === targetLayerId) ?? stack[0];

      // Build a set of signatures present on the target layer (seeded intent)
      const targetSigs = new Set<string>(
        (targetLayer.cavities ?? []).map((c) => cavitySig(c)),
      );

      // Remove ONLY obviously-seeded duplicates from non-target layers when a matching
      // signature already exists on the target layer.
      stack = stack.map((l) => {
        if (l.id === targetLayer.id) return l;

        const nextCavs = (l.cavities ?? []).filter((c) => {
          const id = String((c as any)?.id ?? "");
          const looksSeeded = id.startsWith("seed-cav-");
          if (!looksSeeded) return true; // never delete user cavities

          const sig = cavitySig(c);
          if (!targetSigs.has(sig)) return true;

          // Duplicate seeded cavity → drop it from the wrong layer
          return false;
        });

        return nextCavs.length === (l.cavities ?? []).length
          ? l
          : { ...l, cavities: nextCavs };
      });
    }
    // Choose active layer:
    // - If an explicit target layer index was provided, ALWAYS make it active.
    //   (Do not depend on whether cavities are present at init time.)
    // - Otherwise default to layer 1.
    const preferredActive = hasExplicitTarget ? stack[targetIdx0] : (stack[1] ?? stack[0]);



    // ❗ DO NOT mirror seeded cavities into layout.cavities during init
    return {
      layout: {
        ...rest,
        block: {
          ...block,
          thicknessIn: safeInch(
            preferredActive.thicknessIn ?? block.thicknessIn ?? 1,
            0.5,
          ),
        },
        stack,
        cavities: [], // <-- THIS IS THE FIX (existing behavior in your pasted file)
        editorMode,
      },
      activeLayerId: preferredActive.id,
    };
  }

  // Legacy single-layer fallback:
  if (cavsRaw.length) {
    const seeded = cavsRaw.map((c, i) => ({
      ...c,
      id: `seed-cav-${i + 1}`,
      x: clamp01Or((c as any).x, 0.2),
      y: clamp01Or((c as any).y, 0.2),
    }));
    const cavs = dedupeCavities(seeded);

    const thickness = safeInch(block.thicknessIn ?? 1, 0.5);
    const stack: LayoutLayer[] = [
      {
        id: "layer-1",
        label: "Layer 1",
        thicknessIn: thickness,
        cavities: cavs,
        cropCorners: false,
        roundCorners: false,
        roundRadiusIn: DEFAULT_ROUND_RADIUS_IN,
      },
    ];

    return {
      layout: {
        ...rest,
        block: { ...block, thicknessIn: thickness },
        stack,
        cavities: [...cavs],
        editorMode,
      },
      activeLayerId: "layer-1",
    };
  }

  return {
    layout: {
      ...rest,
      block: { ...block, thicknessIn: safeInch(block.thicknessIn ?? 1, 0.5) },
      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: safeInch(block.thicknessIn ?? 1, 0.5),
          cavities: [],
          cropCorners: false,
          roundCorners: false,
          roundRadiusIn: DEFAULT_ROUND_RADIUS_IN,
        },
      ],
      cavities: [],
      editorMode,
    },
    activeLayerId: "layer-1",
  };
}

function cavitySig(c: Cavity) {
  const r8 = (n: number) => Math.round((Number(n) || 0) * 8) / 8;
  return [
    c.shape,
    r8(c.lengthIn),
    r8(c.widthIn),
    r8(c.depthIn),
    r8((c as any).cornerRadiusIn ?? 0),
  ].join("|");
}

function dedupeCavities(list: Cavity[]) {
  const seen = new Set<string>();
  const out: Cavity[] = [];

  for (const c of list || []) {
    const id = String((c as any)?.id ?? "").trim();
    const key = id ? `id:${id}` : `sig:${cavitySig(c)}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // ❗ DO NOT mutate x/y here.
    // Mirroring must be lossless. Drag logic handles clamping.

    out.push(c);
  }

  return out;
}

function nextCavityNumber(stack: LayoutLayer[]) {
  let max = 0;
  for (const layer of stack) {
    for (const c of layer.cavities) {
      const m = String(c.id || "").match(/(?:seed-cav-|cav-)(\d+)/);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    }
  }
  return max + 1;
}

function remapImportedCavities(params: {
  seedCavs: Cavity[];
  currentBlock: BlockDims;
  seedBlock: BlockDims;
  mode: "append" | "replace";
  startIndex: number;
}) {
  const { seedCavs, currentBlock, seedBlock, mode, startIndex } = params;

  const seedLen = Number((seedBlock as any)?.lengthIn);
  const seedWid = Number((seedBlock as any)?.widthIn);
  const curLen = Number((currentBlock as any)?.lengthIn);
  const curWid = Number((currentBlock as any)?.widthIn);

  const canScale =
    mode === "append" &&
    Number.isFinite(seedLen) &&
    Number.isFinite(seedWid) &&
    Number.isFinite(curLen) &&
    Number.isFinite(curWid) &&
    seedLen > 0 &&
    seedWid > 0 &&
    curLen > 0 &&
    curWid > 0;

  let nextId = startIndex;

  return (seedCavs || []).map((c) => {
    let x = Number((c as any)?.x);
    let y = Number((c as any)?.y);

    if (canScale) {
      const absX = (Number.isFinite(x) ? x : 0.2) * seedLen;
      const absY = (Number.isFinite(y) ? y : 0.2) * seedWid;
      x = absX / curLen;
      y = absY / curWid;
    }

    return {
      ...c,
      id: `cav-${nextId++}`,
      x: clamp01Or(x, 0.2),
      y: clamp01Or(y, 0.2),
    } as Cavity;
  });
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v || 0));
}

function clamp01Or(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return clamp01(fallback);
  return clamp01(n);
}

function clamp01OrKeep(v: any, prior: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    const p = Number(prior);
    if (Number.isFinite(p)) return clamp01(p);
    return clamp01(0.2);
  }
  return clamp01(n);
}

function clamp01OrPreserve(v: any, prior: any, fallback = 0.2) {
  // If we already had a valid prior value, NEVER override it during hydration
  const p = Number(prior);
  if (Number.isFinite(p)) return clamp01(p);

  // Only accept v if it is a clean finite number
  const n = Number(v);
  if (Number.isFinite(n)) return clamp01(n);

  // Fallback ONLY for brand-new cavities
  return clamp01(fallback);
}


function safeInch(v: number | undefined, min: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.round(n * 8) / 8);
}

function normalizeBlockPatch(p: Partial<BlockDims>) {
  const o: Partial<BlockDims> = {};
  if (p.lengthIn != null) o.lengthIn = safeInch(p.lengthIn, 1);
  if (p.widthIn != null) o.widthIn = safeInch(p.widthIn, 1);
  if (p.thicknessIn != null) o.thicknessIn = safeInch(p.thicknessIn, 0.5);

  if (p.cornerStyle != null) {
    const cs = String(p.cornerStyle);
    if (cs === "square" || cs === "chamfer") {
      (o as any).cornerStyle = cs;
    }
  }
  if ((p as any).chamferIn != null) {
    const n = Number((p as any).chamferIn);
    if (Number.isFinite(n) && n >= 0) {
      (o as any).chamferIn = safeInch(n, 0);
    }
  }

  return o;
}

function normalizeCavityPatch(p: Partial<Cavity>) {
  const o: Partial<Cavity> = {};
  if (p.lengthIn != null) o.lengthIn = safeInch(p.lengthIn, 0.25);
  if (p.widthIn != null) o.widthIn = safeInch(p.widthIn, 0.25);
  if (p.depthIn != null) o.depthIn = safeInch(p.depthIn, 0.25);
  if (p.cornerRadiusIn != null) o.cornerRadiusIn = safeInch(p.cornerRadiusIn, 0);
  if (p.label != null) o.label = p.label;
  return o;
}

function formatCavityLabel(
  c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">,
) {
  const L = Math.round(c.lengthIn * 8) / 8;
  const W = Math.round(c.widthIn * 8) / 8;
  const D = Math.round(c.depthIn * 8) / 8;
  return c.shape === "circle" ? `Ø${L}×${D} in` : `${L}×${W}×${D} in`;
}