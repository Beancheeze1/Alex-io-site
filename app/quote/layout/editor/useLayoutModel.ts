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
  const [layout, setLayout] = useState<LayoutModel>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectCavity = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const updateCavityPosition = useCallback(
    (id: string, x: number, y: number) => {
      setLayout((prev) => ({
        ...prev,
        cavities: prev.cavities.map((c) =>
          c.id === id
            ? {
                ...c,
                x: clamp01(x),
                y: clamp01(y),
              }
            : c
        ),
      }));
    },
    []
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
      setLayout((prev) => ({
        ...prev,
        cavities: prev.cavities.map((c) => {
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
        }),
      }));
    },
    []
  );

  const addCavity = useCallback(
    (
      shape: CavityShape,
      size: { lengthIn: number; widthIn: number; depthIn: number; cornerRadiusIn?: number }
    ) => {
      setLayout((prev) => {
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

        return {
          ...prev,
          cavities: [...prev.cavities, newCavity],
        };
      });
    },
    []
  );

  const deleteCavity = useCallback((id: string) => {
    setLayout((prev) => ({
      ...prev,
      cavities: prev.cavities.filter((c) => c.id !== id),
    }));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  return {
    layout,
    selectedId,
    selectCavity,
    updateCavityPosition,
    updateBlockDims,
    updateCavityDims,
    addCavity,
    deleteCavity,
  };
}

/* Helpers */

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
