// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// Client-only module.

"use client";

import { useState, useCallback } from "react";
import type { BlockDims, LayoutModel, Cavity, CavityShape } from "./layoutTypes";

export type UseLayoutModelResult = {
  layout: LayoutModel;
  selectedId: string | null;

  // Multi-layer: active layer tracking (non-breaking addition)
  activeLayerId: string | null;
  setActiveLayerId: (id: string | null) => void;

  selectCavity: (id: string | null) => void;
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
};

export function useLayoutModel(initial: LayoutModel): UseLayoutModelResult {
  const [layout, setLayout] = useState<LayoutModel>(() => {
    // If a multi-layer stack is present, mirror the first layer’s cavities
    // into the legacy `cavities` field so existing consumers keep working.
    if (initial.stack && initial.stack.length > 0) {
      const first = initial.stack[0];
      return {
        ...initial,
        cavities: first.cavities,
      };
    }
    return initial;
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // When a stack exists, default to the first layer as active.
  const [activeLayerId, setActiveLayerId] = useState<string | null>(() => {
    if (initial.stack && initial.stack.length > 0) {
      return initial.stack[0].id;
    }
    return null;
  });

  const selectCavity = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const updateCavityPosition = useCallback(
    (id: string, x: number, y: number) => {
      setLayout((prev) =>
        withUpdatedCavities(prev, activeLayerId, (cavs) =>
          cavs.map((c) =>
            c.id === id
              ? {
                  ...c,
                  x: clamp01(x),
                  y: clamp01(y),
                }
              : c
          )
        )
      );
    },
    [activeLayerId]
  );

  const updateBlockDims = useCallback((patch: Partial<BlockDims>) => {
    setLayout((prev) => ({
      ...prev,
      block: {
        ...prev.block,
        ...normalizeBlockPatch(patch),
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
      setLayout((prev) =>
        withUpdatedCavities(prev, activeLayerId, (cavs) =>
          cavs.map((c) => {
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
          })
        )
      );
    },
    [activeLayerId]
  );

  const addCavity = useCallback(
    (
      shape: CavityShape,
      size: { lengthIn: number; widthIn: number; depthIn: number; cornerRadiusIn?: number }
    ) => {
      setLayout((prev) => {
        // Use the currently visible set (legacy mirror) for layout of new cavities.
        const idx = prev.cavities.length;
        const id = `cav-${idx + 1}`;

        const lengthIn = safeInch(size.lengthIn, 0.5);
        const widthIn = safeInch(size.widthIn, 0.5);
        const depthIn = safeInch(size.depthIn, 0.5);
        const cornerRadiusIn =
          shape === "roundedRect" ? safeInch(size.cornerRadiusIn ?? 0.25, 0) : 0;

        // Drop new cavities roughly centered
        const x = 0.3 + (idx % 2) * 0.2;
        const y = 0.25 + Math.floor(idx / 2) * 0.2;

        const base: Cavity = {
          id,
          label: "",
          shape,
          cornerRadiusIn,
          lengthIn,
          widthIn,
          depthIn,
          x: clamp01(x),
          y: clamp01(y),
        };

        const newCavity: Cavity = {
          ...base,
          label: formatCavityLabel(base),
        };

        return withUpdatedCavities(prev, activeLayerId, (cavs) => [...cavs, newCavity]);
      });
    },
    [activeLayerId]
  );

  const deleteCavity = useCallback((id: string) => {
    setLayout((prev) =>
      withUpdatedCavities(prev, activeLayerId, (cavs) => cavs.filter((c) => c.id !== id))
    );
    setSelectedId((prev) => (prev === id ? null : prev));
  }, [activeLayerId]);

  return {
    layout,
    selectedId,
    activeLayerId,
    setActiveLayerId,
    selectCavity,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
  };
}

/* Helpers */

/**
 * Helper to apply a cavity update in a stack-aware way.
 *
 * - If there is NO stack or NO active layer, behaves like legacy:
 *   updates `layout.cavities` only.
 * - If stack + activeLayerId exist, updates that layer’s cavities AND
 *   keeps `layout.cavities` as a mirror of the active layer.
 */
function withUpdatedCavities(
  prev: LayoutModel,
  activeLayerId: string | null,
  updater: (cavities: Cavity[]) => Cavity[]
): LayoutModel {
  if (!prev.stack || prev.stack.length === 0 || !activeLayerId) {
    const nextCavities = updater(prev.cavities);
    return {
      ...prev,
      cavities: nextCavities,
    };
  }

  const nextStack = prev.stack.map((layer) => {
    if (layer.id !== activeLayerId) return layer;
    const updatedCavities = updater(layer.cavities);
    return {
      ...layer,
      cavities: updatedCavities,
    };
  });

  const activeLayer =
    nextStack.find((layer) => layer.id === activeLayerId) ?? nextStack[0];

  return {
    ...prev,
    stack: nextStack,
    cavities: activeLayer ? activeLayer.cavities : prev.cavities,
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
