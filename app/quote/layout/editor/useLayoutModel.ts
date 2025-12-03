// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// Now multi-layer aware, but still Path A safe:
//  - Legacy layouts (block + cavities only) still work.
//  - We seed a simple 3-layer stack for a nicer demo:
//      Bottom pad  / Center layer / Top pad
//  - New cavities go into the *active* layer.
//  - layout.cavities always reflects the active layer.
//
// Client-only module.

"use client";

import { useState, useCallback } from "react";
import type { BlockDims, LayoutModel, Cavity, CavityShape } from "./layoutTypes";

type LayoutLayerLike = {
  id: string;
  label: string;
  cavities: Cavity[];
};

type LayoutState = {
  layout: LayoutModel & { stack?: LayoutLayerLike[] };
  activeLayerId: string | null;
};

export type UseLayoutModelResult = {
  layout: LayoutModel & { stack?: LayoutLayerLike[] };
  selectedId: string | null;
  activeLayerId: string | null;
  selectCavity: (id: string | null) => void;
  setActiveLayerId: (id: string) => void;

  // cavity operations (target the active layer)
  updateCavityPosition: (id: string, x: number, y: number) => void;
  updateBlockDims: (patch: Partial<BlockDims>) => void;
  updateCavityDims: (
    id: string,
    patch: Partial<
      Pick<Cavity, "lengthIn" | "widthIn" | "depthIn" | "cornerRadiusIn" | "label">
    >
  ) => void;
  addCavity: (
    shape: CavityShape,
    size: { lengthIn: number; widthIn: number; depthIn: number; cornerRadiusIn?: number }
  ) => void;
  deleteCavity: (id: string) => void;

  // layer management for the demo
  addLayer: () => void;
  renameLayer: (id: string, label: string) => void;
  deleteLayer: (id: string) => void;
};

export function useLayoutModel(initial: LayoutModel): UseLayoutModelResult {
  const [state, setState] = useState<LayoutState>(() => normalizeInitialLayout(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { layout, activeLayerId } = state;

  const selectCavity = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const setActiveLayerId = useCallback((id: string) => {
    setState((prev) => {
      const stack = getStack(prev.layout);
      if (!stack || stack.length === 0) return prev;

      const nextLayer =
        stack.find((layer) => layer.id === id) ?? stack[0];

      return {
        layout: {
          ...prev.layout,
          stack,
          cavities: [...nextLayer.cavities],
        },
        activeLayerId: nextLayer.id,
      };
    });
    setSelectedId(null);
  }, []);

  const updateCavityPosition = useCallback(
    (id: string, x: number, y: number) => {
      setState((prev) => {
        const { layout, activeLayerId } = prev;
        const stack = getStack(layout);

        // No stack → legacy single-layer behavior
        if (!stack || stack.length === 0) {
          return {
            ...prev,
            layout: {
              ...layout,
              cavities: layout.cavities.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      x: clamp01(x),
                      y: clamp01(y),
                    }
                  : c
              ),
            },
          };
        }

        const currentId = activeLayerId ?? stack[0].id;
        const nextStack = stack.map((layer) => {
          if (layer.id !== currentId) return layer;
          return {
            ...layer,
            cavities: layer.cavities.map((c) =>
              c.id === id
                ? {
                    ...c,
                    x: clamp01(x),
                    y: clamp01(y),
                  }
                : c
            ),
          };
        });

        const activeLayer =
          nextStack.find((l) => l.id === currentId) ?? nextStack[0];

        return {
          layout: {
            ...layout,
            stack: nextStack,
            cavities: [...activeLayer.cavities],
          },
          activeLayerId: activeLayer.id,
        };
      });
    },
    []
  );

  const updateBlockDims = useCallback((patch: Partial<BlockDims>) => {
    setState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        block: {
          ...prev.layout.block,
          ...normalizeBlockPatch(patch),
        },
      },
    }));
  }, []);

  const updateCavityDims = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<Cavity, "lengthIn" | "widthIn" | "depthIn" | "cornerRadiusIn" | "label">
      >
    ) => {
      setState((prev) => {
        const { layout, activeLayerId } = prev;
        const stack = getStack(layout);

        // Helper to apply dims update to one cavity list
        const applyDims = (list: Cavity[]): Cavity[] =>
          list.map((c) => {
            if (c.id !== id) return c;

            const norm = normalizeCavityPatch(patch);
            const updated: Cavity = {
              ...c,
              ...norm,
            };

            // Always keep the label in sync with dims
            return {
              ...updated,
              label: formatCavityLabel(updated),
            };
          });

        if (!stack || stack.length === 0) {
          const nextCavities = applyDims(layout.cavities);
          return {
            ...prev,
            layout: {
              ...layout,
              cavities: nextCavities,
            },
          };
        }

        const currentId = activeLayerId ?? stack[0].id;
        const nextStack = stack.map((layer) => {
          if (layer.id !== currentId) return layer;
          return {
            ...layer,
            cavities: applyDims(layer.cavities),
          };
        });

        const activeLayer =
          nextStack.find((l) => l.id === currentId) ?? nextStack[0];

        return {
          layout: {
            ...layout,
            stack: nextStack,
            cavities: [...activeLayer.cavities],
          },
          activeLayerId: activeLayer.id,
        };
      });
    },
    []
  );

  const addCavity = useCallback(
    (
      shape: CavityShape,
      size: { lengthIn: number; widthIn: number; depthIn: number; cornerRadiusIn?: number }
    ) => {
      setState((prev) => {
        const { layout, activeLayerId } = prev;
        const stack = getStack(layout);

        // Compute a global cavity index (across all layers) for a stable ID
        const totalCavities = stack && stack.length > 0
          ? stack.reduce((sum, layer) => sum + layer.cavities.length, 0)
          : layout.cavities.length;

        const id = `cav-${totalCavities + 1}`;

        const lengthIn = safeInch(size.lengthIn, 0.5);
        const widthIn = safeInch(size.widthIn, 0.5);
        const depthIn = safeInch(size.depthIn, 0.5);
        const cornerRadiusIn =
          shape === "roundedRect" ? safeInch(size.cornerRadiusIn ?? 0.25, 0) : 0;

        // Try to place new cavities roughly in "dead space"
        const col = totalCavities % 3;
        const row = Math.floor(totalCavities / 3);

        const xBase = 0.2 + col * 0.25;
        const yBase = 0.2 + row * 0.2;

        const base: Cavity = {
          id,
          label: "",
          shape,
          cornerRadiusIn,
          lengthIn,
          widthIn,
          depthIn,
          x: clamp01(xBase),
          y: clamp01(yBase),
        };

        const newCavity: Cavity = {
          ...base,
          label: formatCavityLabel(base),
        };

        // Legacy single-layer behavior
        if (!stack || stack.length === 0) {
          return {
            ...prev,
            layout: {
              ...layout,
              cavities: [...layout.cavities, newCavity],
            },
          };
        }

        // Multi-layer: add to active layer
        const currentId = activeLayerId ?? stack[0].id;
        const nextStack = stack.map((layer) => {
          if (layer.id !== currentId) return layer;
          return {
            ...layer,
            cavities: [...layer.cavities, newCavity],
          };
        });

        const activeLayer =
          nextStack.find((l) => l.id === currentId) ?? nextStack[0];

        return {
          layout: {
            ...layout,
            stack: nextStack,
            cavities: [...activeLayer.cavities],
          },
          activeLayerId: activeLayer.id,
        };
      });
    },
    []
  );

  const deleteCavity = useCallback((id: string) => {
    setState((prev) => {
      const { layout, activeLayerId } = prev;
      const stack = getStack(layout);

      if (!stack || stack.length === 0) {
        return {
          ...prev,
          layout: {
            ...layout,
            cavities: layout.cavities.filter((c) => c.id !== id),
          },
        };
      }

      const nextStack = stack.map((layer) => ({
        ...layer,
        cavities: layer.cavities.filter((c) => c.id !== id),
      }));

      const currentId = activeLayerId ?? nextStack[0]?.id ?? null;
      const activeLayer =
        (currentId &&
          nextStack.find((l) => l.id === currentId)) ??
        nextStack[0] ??
        null;

      return {
        layout: {
          ...layout,
          stack: nextStack,
          cavities: activeLayer ? [...activeLayer.cavities] : [],
        },
        activeLayerId: activeLayer ? activeLayer.id : null,
      };
    });

    setSelectedId((prevId) => (prevId === id ? null : prevId));
  }, []);

  // ---- Layer management (demo) ----

  const addLayer = useCallback(() => {
    setState((prev) => {
      const { layout, activeLayerId } = prev;
      const stack = getStack(layout) ?? [];

      const nextIndex = stack.length + 1;
      const newId = `layer-${nextIndex}`;
      const newLayer: LayoutLayerLike = {
        id: newId,
        label: `Layer ${nextIndex}`,
        cavities: [],
      };

      const nextStack = [...stack, newLayer];

      return {
        layout: {
          ...layout,
          stack: nextStack,
          cavities: [], // new layer is empty
        },
        activeLayerId: newId,
      };
    });
    setSelectedId(null);
  }, []);

  const renameLayer = useCallback((id: string, label: string) => {
    setState((prev) => {
      const { layout } = prev;
      const stack = getStack(layout);
      if (!stack || stack.length === 0) return prev;

      const nextStack = stack.map((layer) =>
        layer.id === id
          ? { ...layer, label: label.trim() || layer.label }
          : layer
      );

      return {
        ...prev,
        layout: {
          ...layout,
          stack: nextStack,
        },
      };
    });
  }, []);

  const deleteLayer = useCallback((id: string) => {
    setState((prev) => {
      const { layout, activeLayerId } = prev;
      const stack = getStack(layout);
      if (!stack || stack.length <= 1) {
        // never delete the last layer
        return prev;
      }

      const filtered = stack.filter((layer) => layer.id !== id);
      if (filtered.length === stack.length) return prev;

      const nextActiveId =
        activeLayerId === id ? filtered[0].id : activeLayerId;
      const activeLayer =
        filtered.find((l) => l.id === nextActiveId) ?? filtered[0];

      return {
        layout: {
          ...layout,
          stack: filtered,
          cavities: [...activeLayer.cavities],
        },
        activeLayerId: activeLayer.id,
      };
    });
    setSelectedId(null);
  }, []);

  return {
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
  };
}

/* ---------- Helpers ---------- */

function getStack(layout: LayoutModel & { stack?: LayoutLayerLike[] }): LayoutLayerLike[] | undefined {
  const raw = (layout as any).stack as LayoutLayerLike[] | undefined;
  if (!raw) return undefined;
  return raw;
}

// Normalize legacy layouts into a simple 3-layer stack
function normalizeInitialLayout(initial: LayoutModel): LayoutState {
  const base: LayoutModel & { stack?: LayoutLayerLike[] } = {
    block: { ...initial.block },
    cavities: Array.isArray(initial.cavities) ? [...initial.cavities] : [],
    stack: getStack(initial as any) ?? undefined,
  };

  const existingStack = base.stack;
  if (existingStack && existingStack.length > 0) {
    const first = existingStack[0];
    return {
      layout: {
        ...base,
        stack: existingStack.map((layer) => ({
          id: layer.id,
          label: layer.label,
          cavities: [...layer.cavities],
        })),
        cavities: [...first.cavities],
      },
      activeLayerId: first.id,
    };
  }

  // No stack yet → seed a simple 3-layer demo:
  // Bottom pad (empty), Center layer (legacy cavities), Top pad (empty)
  const centerId = "layer-center";
  const seededStack: LayoutLayerLike[] = [
    { id: "layer-bottom", label: "Bottom pad", cavities: [] },
    { id: centerId, label: "Center layer", cavities: [...base.cavities] },
    { id: "layer-top", label: "Top pad", cavities: [] },
  ];

  return {
    layout: {
      ...base,
      stack: seededStack,
      cavities: [...base.cavities], // mirrors active (center) layer
    },
    activeLayerId: centerId,
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function safeInch(v: number | undefined, min: number): number {
  if (v == null || Number.isNaN(Number(v))) return min;
  const n = Number(v);
  return n < min ? min : roundToEighth(n);
}

function roundToEighth(v: number): number {
  return Math.round(v * 8) / 8;
}

function normalizeBlockPatch(patch: Partial<BlockDims>): Partial<BlockDims> {
  const out: Partial<BlockDims> = {};
  if (patch.lengthIn != null) out.lengthIn = safeInch(patch.lengthIn, 1);
  if (patch.widthIn != null) out.widthIn = safeInch(patch.widthIn, 1);
  if (patch.thicknessIn != null) out.thicknessIn = safeInch(patch.thicknessIn, 0.5);
  return out;
}

function normalizeCavityPatch(
  patch: Partial<
    Pick<Cavity, "lengthIn" | "widthIn" | "depthIn" | "cornerRadiusIn" | "label">
  >
): Partial<Cavity> {
  const out: Partial<Cavity> = {};
  if (patch.lengthIn != null) out.lengthIn = safeInch(patch.lengthIn, 0.25);
  if (patch.widthIn != null) out.widthIn = safeInch(patch.widthIn, 0.25);
  if (patch.depthIn != null) out.depthIn = safeInch(patch.depthIn, 0.25);
  if (patch.cornerRadiusIn != null) out.cornerRadiusIn = safeInch(patch.cornerRadiusIn, 0);
  if (patch.label != null) out.label = patch.label;
  return out;
}

/**
 * Build a readable label based on shape + dims.
 * Rect:  "L×W×D in"
 * Circle: "ØD×Dpth in"
 */
function formatCavityLabel(c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">) {
  const L = roundToEighth(c.lengthIn);
  const W = roundToEighth(c.widthIn);
  const D = roundToEighth(c.depthIn);

  if (c.shape === "circle") {
    // lengthIn == widthIn == diameter
    return `Ø${L}×${D} in`;
  }

  return `${L}×${W}×${D} in`;
}
