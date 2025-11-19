// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// This is a client-only module.

"use client";

import { useState, useCallback } from "react";
import type { LayoutModel, Cavity } from "./layoutTypes";

export type UseLayoutModelResult = {
  layout: LayoutModel;
  selectedId: string | null;
  selectCavity: (id: string | null) => void;
  /**
   * Multi-purpose update:
   *  - id like "cav-1"          -> update x/y position (drag move)
   *  - id like "resize:cav-1"   -> update length/width (drag resize)
   *
   * x/y are always 0–1 normalized values.
   */
  updateCavityPosition: (id: string, x: number, y: number) => void;
  addCavity: (template: {
    lengthIn: number;
    widthIn: number;
    depthIn: number;
    label?: string;
  }) => void;
  deleteCavity: (id: string) => void;
};

const SNAP_SIZE_IN = 0.125; // 1/8" increments for length/width when resizing

export function useLayoutModel(initial: LayoutModel): UseLayoutModelResult {
  const [layout, setLayout] = useState<LayoutModel>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectCavity = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const updateCavityPosition = useCallback(
    (id: string, x: number, y: number) => {
      setLayout((prev) => {
        const isResize = id.startsWith("resize:");
        const realId = isResize ? id.slice("resize:".length) : id;

        const blockLen = prev.block.lengthIn || 1;
        const blockWid = prev.block.widthIn || 1;

        return {
          ...prev,
          cavities: prev.cavities.map((c) => {
            if (c.id !== realId) return c;

            if (isResize) {
              // Resize mode: x/y encode new length/width as 0–1 of block.
              const lengthNorm = clamp01(x);
              const widthNorm = clamp01(y);

              const minSizeIn = 0.25; // don't let cavities collapse

              const newLength = Math.max(minSizeIn, lengthNorm * blockLen);
              const newWidth = Math.max(minSizeIn, widthNorm * blockWid);

              // Snap to 1/8" increments
              const snappedLength =
                Math.round(newLength / SNAP_SIZE_IN) * SNAP_SIZE_IN;
              const snappedWidth =
                Math.round(newWidth / SNAP_SIZE_IN) * SNAP_SIZE_IN;

              return {
                ...c,
                lengthIn: snappedLength,
                widthIn: snappedWidth,
              };
            }

            // Move mode: x/y are normalized offsets inside block footprint.
            return {
              ...c,
              x: clamp01(x),
              y: clamp01(y),
            };
          }),
        };
      });
    },
    []
  );

  const addCavity = useCallback(
    (template: {
      lengthIn: number;
      widthIn: number;
      depthIn: number;
      label?: string;
    }) => {
      setLayout((prev) => {
        const blockLen = prev.block.lengthIn || 1;
        const blockWid = prev.block.widthIn || 1;

        // Center the new cavity in the block by default.
        const lengthNorm = template.lengthIn / blockLen;
        const widthNorm = template.widthIn / blockWid;

        const x = clamp01(0.5 - lengthNorm / 2);
        const y = clamp01(0.5 - widthNorm / 2);

        const nextIndex = prev.cavities.length;
        const id = `cav-${Date.now()}-${nextIndex}`;

        const label =
          template.label ??
          `${template.lengthIn}×${template.widthIn}×${template.depthIn} in`;

        const newCavity: Cavity = {
          id,
          label,
          lengthIn: template.lengthIn,
          widthIn: template.widthIn,
          depthIn: template.depthIn,
          x,
          y,
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
    setSelectedId((prevId) => (prevId === id ? null : prevId));
  }, []);

  return {
    layout,
    selectedId,
    selectCavity,
    updateCavityPosition,
    addCavity,
    deleteCavity,
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
