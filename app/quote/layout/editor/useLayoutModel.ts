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
