// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// Client-only module.

"use client";

import { useState, useCallback } from "react";
import type {
  LayoutModel,
  Cavity,
  CavityShape,
  NewCavityInput,
} from "./layoutTypes";
import { clampCavityToBlock, snapInches } from "./layoutTypes";

export type UseLayoutModelResult = {
  layout: LayoutModel;
  selectedId: string | null;
  selectCavity: (id: string | null) => void;
  updateCavityPosition: (id: string, xNorm: number, yNorm: number) => void;
  updateCavitySize: (id: string, lengthIn: number, widthIn: number) => void;
  updateCavityDepth: (id: string, depthIn: number) => void;
  updateCavityCornerRadius: (id: string, cornerRadiusIn: number) => void;
  updateCavityLabel: (id: string, label: string) => void;
  updateCavityShape: (id: string, shape: CavityShape) => void;
  addCavity: (input: NewCavityInput) => void;
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
        const block = prev.block;
        return {
          ...prev,
          cavities: prev.cavities.map((c) => {
            if (c.id !== id) return c;
            const next: Cavity = {
              ...c,
              x: xNorm,
              y: yNorm,
            };
            return clampCavityToBlock(block, next);
          }),
        };
      });
    },
    []
  );

  const updateCavitySize = useCallback(
    (id: string, lengthIn: number, widthIn: number) => {
      setLayout((prev) => {
        const block = prev.block;
        return {
          ...prev,
          cavities: prev.cavities.map((c) => {
            if (c.id !== id) return c;
            const next: Cavity = {
              ...c,
              lengthIn: snapInches(lengthIn),
              widthIn: snapInches(widthIn),
            };
            return clampCavityToBlock(block, next);
          }),
        };
      });
    },
    []
  );

  const updateCavityDepth = useCallback((id: string, depthIn: number) => {
    setLayout((prev) => ({
      ...prev,
      cavities: prev.cavities.map((c) =>
        c.id === id
          ? {
              ...c,
              depthIn: snapInches(depthIn),
            }
          : c
      ),
    }));
  }, []);

  const updateCavityCornerRadius = useCallback(
    (id: string, cornerRadiusIn: number) => {
      setLayout((prev) => ({
        ...prev,
        cavities: prev.cavities.map((c) =>
          c.id === id
            ? {
                ...c,
                cornerRadiusIn: Math.max(0, snapInches(cornerRadiusIn)),
              }
            : c
        ),
      }));
    },
    []
  );

  const updateCavityLabel = useCallback((id: string, label: string) => {
    setLayout((prev) => ({
      ...prev,
      cavities: prev.cavities.map((c) =>
        c.id === id
          ? {
              ...c,
              label: label.trim() || c.label,
            }
          : c
      ),
    }));
  }, []);

  const updateCavityShape = useCallback((id: string, shape: CavityShape) => {
    setLayout((prev) => ({
      ...prev,
      cavities: prev.cavities.map((c) =>
        c.id === id
          ? {
              ...c,
              shape,
            }
          : c
      ),
    }));
  }, []);

  const addCavity = useCallback((input: NewCavityInput) => {
    setLayout((prev) => {
      const { block } = prev;
      const index = prev.cavities.length;

      const baseLength = snapInches(input.lengthIn);
      const baseWidth = snapInches(input.widthIn);
      const baseDepth = snapInches(input.depthIn);

      // Start roughly centered.
      const xCenterNorm = 0.5;
      const yCenterNorm = 0.5;

      const xNorm =
        block.lengthIn > 0
          ? xCenterNorm - baseLength / 2 / block.lengthIn
          : 0.25;
      const yNorm =
        block.widthIn > 0
          ? yCenterNorm - baseWidth / 2 / block.widthIn
          : 0.25;

      const raw: Cavity = {
        id: `cav-${Date.now()}-${index}`,
        label:
          input.label ||
          `${baseLength}×${baseWidth}×${baseDepth} in`.replace(/\.0+/g, ""),
        lengthIn: baseLength,
        widthIn: baseWidth,
        depthIn: baseDepth,
        shape: input.shape ?? "rect",
        cornerRadiusIn: input.cornerRadiusIn ?? 0,
        x: xNorm,
        y: yNorm,
      };

      const positioned = clampCavityToBlock(block, raw);

      return {
        ...prev,
        cavities: [...prev.cavities, positioned],
      };
    });
  }, []);

  const deleteCavity = useCallback((id: string) => {
    setLayout((prev) => ({
      ...prev,
      cavities: prev.cavities.filter((c) => c.id !== id),
    }));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  return {
    layout,
    selectedId,
    selectCavity,
    updateCavityPosition,
    updateCavitySize,
    updateCavityDepth,
    updateCavityCornerRadius,
    updateCavityLabel,
    updateCavityShape,
    addCavity,
    deleteCavity,
  };
}
