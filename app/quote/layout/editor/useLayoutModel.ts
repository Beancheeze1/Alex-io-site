// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// This is a client-only module.

"use client";

import { useState, useCallback } from "react";
import type { LayoutModel, Cavity, CavityShape } from "./layoutTypes";

const SNAP_SIZE_IN = 0.125; // 1/8" increments
const MIN_SIZE_IN = 0.25;   // don't let cavities collapse
const WALL_MARGIN_IN = 0.5; // 1/2" wall around inside of block

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
    shape?: CavityShape;
    cornerRadiusIn?: number;
  }) => void;
  deleteCavity: (id: string) => void;
  updateCavityFields: (
    id: string,
    updates: {
      lengthIn?: number;
      widthIn?: number;
      depthIn?: number;
      cornerRadiusIn?: number;
      shape?: CavityShape;
    }
  ) => void;
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
              let lengthNorm = clamp01(x);
              let widthNorm = clamp01(y);

              let newLength = Math.max(MIN_SIZE_IN, lengthNorm * blockLen);
              let newWidth = Math.max(MIN_SIZE_IN, widthNorm * blockWid);

              // Respect wall margins based on current position.
              const leftIn = c.x * blockLen;
              const topIn = c.y * blockWid;

              const maxLenByRight = blockLen - WALL_MARGIN_IN - leftIn;
              const maxLenByWalls = blockLen - 2 * WALL_MARGIN_IN;
              const maxLen = Math.max(
                MIN_SIZE_IN,
                Math.min(maxLenByRight, maxLenByWalls)
              );

              const maxWidByBottom = blockWid - WALL_MARGIN_IN - topIn;
              const maxWidByWalls = blockWid - 2 * WALL_MARGIN_IN;
              const maxWid = Math.max(
                MIN_SIZE_IN,
                Math.min(maxWidByBottom, maxWidByWalls)
              );

              newLength = Math.min(newLength, maxLen);
              newWidth = Math.min(newWidth, maxWid);

              // Snap to 1/8" increments
              const snappedLength = snapTo(newLength, SNAP_SIZE_IN, MIN_SIZE_IN);
              const snappedWidth = snapTo(newWidth, SNAP_SIZE_IN, MIN_SIZE_IN);

              return {
                ...c,
                lengthIn: snappedLength,
                widthIn: snappedWidth,
              };
            }

            // Move mode: x/y are normalized offsets inside block footprint.
            // We enforce the 0.5" wall by constraining x/y so the cavity
            // always sits within [margin, block-margin] in inches.
            const cavLen = c.lengthIn;
            const cavWid = c.widthIn;

            const minXNorm = WALL_MARGIN_IN / blockLen;
            const maxXNorm =
              1 - WALL_MARGIN_IN / blockLen - cavLen / blockLen;

            const minYNorm = WALL_MARGIN_IN / blockWid;
            const maxYNorm =
              1 - WALL_MARGIN_IN / blockWid - cavWid / blockWid;

            const clampedX = clampRange(clamp01(x), minXNorm, maxXNorm);
            const clampedY = clampRange(clamp01(y), minYNorm, maxYNorm);

            return {
              ...c,
              x: clampedX,
              y: clampedY,
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
      shape?: CavityShape;
      cornerRadiusIn?: number;
    }) => {
      setLayout((prev) => {
        const blockLen = prev.block.lengthIn || 1;
        const blockWid = prev.block.widthIn || 1;

        // Center the new cavity within the wall margins.
        const lengthNorm = template.lengthIn / blockLen;
        const widthNorm = template.widthIn / blockWid;

        const usableLen = 1 - 2 * (WALL_MARGIN_IN / blockLen);
        const usableWid = 1 - 2 * (WALL_MARGIN_IN / blockWid);

        const minXNorm = WALL_MARGIN_IN / blockLen;
        const minYNorm = WALL_MARGIN_IN / blockWid;

        let x = minXNorm + Math.max(0, (usableLen - lengthNorm) / 2);
        let y = minYNorm + Math.max(0, (usableWid - widthNorm) / 2);

        x = clamp01(x);
        y = clamp01(y);

        const nextIndex = prev.cavities.length;
        const id = `cav-${Date.now()}-${nextIndex}`;

        const label =
          template.label ??
          `${template.lengthIn}×${template.widthIn}×${template.depthIn} in`;

        const shape: CavityShape = template.shape ?? "rect";
        const cornerRadiusIn = template.cornerRadiusIn ?? 0;

        const newCavity: Cavity = {
          id,
          label,
          lengthIn: template.lengthIn,
          widthIn: template.widthIn,
          depthIn: template.depthIn,
          shape,
          cornerRadiusIn,
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

  const updateCavityFields = useCallback(
    (
      id: string,
      updates: {
        lengthIn?: number;
        widthIn?: number;
        depthIn?: number;
        cornerRadiusIn?: number;
        shape?: CavityShape;
      }
    ) => {
      setLayout((prev) => {
        const blockLen = prev.block.lengthIn || 1;
        const blockWid = prev.block.widthIn || 1;

        return {
          ...prev,
          cavities: prev.cavities.map((c) => {
            if (c.id !== id) return c;

            let lengthIn = updates.lengthIn ?? c.lengthIn;
            let widthIn = updates.widthIn ?? c.widthIn;
            let depthIn = updates.depthIn ?? c.depthIn;
            let cornerRadiusIn =
              updates.cornerRadiusIn ?? c.cornerRadiusIn ?? 0;
            const shape = updates.shape ?? c.shape;

            // Basics
            lengthIn = snapTo(lengthIn, SNAP_SIZE_IN, MIN_SIZE_IN);
            widthIn = snapTo(widthIn, SNAP_SIZE_IN, MIN_SIZE_IN);
            depthIn = depthIn < 0 ? 0 : depthIn;
            cornerRadiusIn = cornerRadiusIn < 0 ? 0 : cornerRadiusIn;

            // Respect wall margins using current x/y.
            const leftIn = c.x * blockLen;
            const topIn = c.y * blockWid;

            const maxLenByRight = blockLen - WALL_MARGIN_IN - leftIn;
            const maxLenByWalls = blockLen - 2 * WALL_MARGIN_IN;
            const maxLen = Math.max(
              MIN_SIZE_IN,
              Math.min(maxLenByRight, maxLenByWalls)
            );

            const maxWidByBottom = blockWid - WALL_MARGIN_IN - topIn;
            const maxWidByWalls = blockWid - 2 * WALL_MARGIN_IN;
            const maxWid = Math.max(
              MIN_SIZE_IN,
              Math.min(maxWidByBottom, maxWidByWalls)
            );

            lengthIn = Math.min(lengthIn, maxLen);
            widthIn = Math.min(widthIn, maxWid);

            return {
              ...c,
              lengthIn,
              widthIn,
              depthIn,
              cornerRadiusIn,
              shape,
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
    addCavity,
    deleteCavity,
    updateCavityFields,
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampRange(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  if (min > max) return v; // degenerate case; just return raw
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function snapTo(value: number, step: number, min: number): number {
  if (Number.isNaN(value)) return min;
  const snapped = Math.round(value / step) * step;
  return snapped < min ? min : snapped;
}
