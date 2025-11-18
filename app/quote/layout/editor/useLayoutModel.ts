// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// This is a client-only module.

"use client";

import { useState, useCallback } from "react";
import type { LayoutModel } from "./layoutTypes";

export type UseLayoutModelResult = {
  layout: LayoutModel;
  selectedId: string | null;
  selectCavity: (id: string | null) => void;
  /**
   * Multi-purpose update:
   *  - id like "cav-1"  -> update x/y position (drag move)
   *  - id like "resize:cav-1" -> update length/width (drag resize)
   *
   * x/y are always 0–1 normalized values.
   */
  updateCavityPosition: (id: string, x: number, y: number) => void;
};

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

              return {
                ...c,
                lengthIn: newLength,
                widthIn: newWidth,
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

  return {
    layout,
    selectedId,
    selectCavity,
    updateCavityPosition,
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
