// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// Client-only module.

"use client";

import { useState, useCallback } from "react";
import {
  LayoutModel,
  Cavity,
  CavityShape,
  WALL_MARGIN_IN,
  SNAP_IN,
  snapInches,
  clampCavityPosition,
  clampCavitySize,
} from "./layoutTypes";

export type UseLayoutModelResult = {
  layout: LayoutModel;
  selectedId: string | null;
  selectCavity: (id: string | null) => void;
  updateCavityPosition: (id: string, x: number, y: number) => void;
  updateCavitySize: (id: string, lengthIn: number, widthIn: number) => void;
  updateCavityMeta: (id: string, patch: Partial<Cavity>) => void;
  updateBlockSize: (lengthIn: number, widthIn: number, thicknessIn: number) => void;
  addCavity: (shape: CavityShape) => void;
  deleteCavity: (id: string) => void;
};

export function useLayoutModel(initial: LayoutModel): UseLayoutModelResult {
  const [layout, setLayout] = useState<LayoutModel>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectCavity = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const updateCavityPosition = useCallback(
    (id: string, xNorm: number, yNorm: number) => {
      setLayout((prev) => {
        const { block } = prev;
        return {
          ...prev,
          cavities: prev.cavities.map((c) => {
            if (c.id !== id) return c;
            const { x, y } = clampCavityPosition(c, block, xNorm, yNorm);
            return { ...c, x, y };
          }),
        };
      });
    },
    []
  );

  const updateCavitySize = useCallback(
    (id: string, lengthIn: number, widthIn: number) => {
      setLayout((prev) => {
        const { block } = prev;
        return {
          ...prev,
          cavities: prev.cavities.map((c) => {
            if (c.id !== id) return c;

            const size = clampCavitySize(c, block, lengthIn, widthIn);
            const { x, y } = clampCavityPosition(
              { ...c, ...size },
              block,
              c.x,
              c.y
            );

            return {
              ...c,
              ...size,
              x,
              y,
            };
          }),
        };
      });
    },
    []
  );

  const updateCavityMeta = useCallback(
    (id: string, patch: Partial<Cavity>) => {
      setLayout((prev) => ({
        ...prev,
        cavities: prev.cavities.map((c) =>
          c.id === id ? { ...c, ...patch } : c
        ),
      }));
    },
    []
  );

  const updateBlockSize = useCallback(
    (lengthIn: number, widthIn: number, thicknessIn: number) => {
      setLayout((prev) => {
        let L = snapInches(lengthIn);
        let W = snapInches(widthIn);
        let T = snapInches(thicknessIn || prev.block.thicknessIn || 2);

        const minL = 2 * WALL_MARGIN_IN + SNAP_IN;
        const minW = 2 * WALL_MARGIN_IN + SNAP_IN;

        if (L < minL) L = minL;
        if (W < minW) W = minW;

        const block = { lengthIn: L, widthIn: W, thicknessIn: T };

        const cavities = prev.cavities.map((c) => {
          // Make sure size still fits new block
          const size = clampCavitySize(c, block, c.lengthIn, c.widthIn);
          const { x, y } = clampCavityPosition(
            { ...c, ...size },
            block,
            c.x,
            c.y
          );
          return { ...c, ...size, x, y };
        });

        return { block, cavities };
      });
    },
    []
  );

  const addCavity = useCallback((shape: CavityShape) => {
    setLayout((prev) => {
      const { block } = prev;
      const baseLength = 3;
      const baseWidth = 2;

      const lengthIn = snapInches(
        Math.min(baseLength, block.lengthIn - 2 * WALL_MARGIN_IN)
      );
      const widthIn = snapInches(
        Math.min(baseWidth, block.widthIn - 2 * WALL_MARGIN_IN)
      );

      const id = `cav-${Date.now()}`;
      const depthIn = snapInches(block.thicknessIn / 2 || 1);
      const cornerRadiusIn = shape === "roundRect" ? 0.5 : 0;

      // Start roughly centered inside the inner block
      const cavLenNorm = lengthIn / block.lengthIn;
      const cavWidNorm = widthIn / block.widthIn;

      const innerXNorm = WALL_MARGIN_IN / block.lengthIn;
      const innerYNorm = WALL_MARGIN_IN / block.widthIn;
      const maxXNorm = 1 - WALL_MARGIN_IN / block.lengthIn - cavLenNorm;
      const maxYNorm = 1 - WALL_MARGIN_IN / block.widthIn - cavWidNorm;

      const x = (innerXNorm + maxXNorm) / 2;
      const y = (innerYNorm + maxYNorm) / 2;

      const newCavity: Cavity = {
        id,
        label: `${lengthIn}×${widthIn}×${depthIn}"`,
        shape,
        lengthIn,
        widthIn,
        depthIn,
        cornerRadiusIn,
        x,
        y,
      };

      return {
        ...prev,
        cavities: [...prev.cavities, newCavity],
      };
    });
  }, []);

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
    updateCavitySize,
    updateCavityMeta,
    updateBlockSize,
    addCavity,
    deleteCavity,
  };
}
