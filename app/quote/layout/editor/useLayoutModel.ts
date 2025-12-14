// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// HARDENED:
//  - Single source of truth for cavities = stack[layer].cavities
//  - layout.cavities is ALWAYS a mirror of the active layer
//  - Prevents double-seeding on editor open
//  - Legacy layouts normalized exactly once
//  - Path A safe

"use client";

import { useState, useCallback } from "react";
import type { BlockDims, LayoutModel, Cavity, CavityShape } from "./layoutTypes";

type LayoutLayerLike = {
  id: string;
  label: string;
  cavities: Cavity[];
};

type LayoutState = {
  layout: LayoutModel & { stack: LayoutLayerLike[] };
  activeLayerId: string;
};

export type UseLayoutModelResult = {
  layout: LayoutModel & { stack: LayoutLayerLike[] };
  selectedId: string | null;
  activeLayerId: string;
  selectCavity: (id: string | null) => void;
  setActiveLayerId: (id: string) => void;

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
      const layer = prev.layout.stack.find((l) => l.id === id) ?? prev.layout.stack[0];
      return {
        layout: {
          ...prev.layout,
          cavities: [...layer.cavities],
        },
        activeLayerId: layer.id,
      };
    });
    setSelectedId(null);
  }, []);

  const updateCavityPosition = useCallback((id: string, x: number, y: number) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((layer) =>
        layer.id !== prev.activeLayerId
          ? layer
          : {
              ...layer,
              cavities: layer.cavities.map((c) =>
                c.id === id ? { ...c, x: clamp01(x), y: clamp01(y) } : c,
              ),
            },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...active.cavities],
        },
        activeLayerId: active.id,
      };
    });
  }, []);

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

  const updateCavityDims = useCallback((id: string, patch: Partial<Cavity>) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((layer) =>
        layer.id !== prev.activeLayerId
          ? layer
          : {
              ...layer,
              cavities: layer.cavities.map((c) =>
                c.id !== id
                  ? c
                  : {
                      ...c,
                      ...normalizeCavityPatch(patch),
                    },
              ),
            },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...active.cavities],
        },
        activeLayerId: active.id,
      };
    });
  }, []);

  const addCavity = useCallback((shape: CavityShape, size: any) => {
    setState((prev) => {
      const total =
        prev.layout.stack.reduce((s, l) => s + l.cavities.length, 0) + 1;

      const base: Cavity = {
        id: `cav-${total}`,
        shape,
        lengthIn: safeInch(size.lengthIn, 0.5),
        widthIn: safeInch(size.widthIn, 0.5),
        depthIn: safeInch(size.depthIn, 0.5),
        cornerRadiusIn:
          shape === "roundedRect" ? safeInch(size.cornerRadiusIn ?? 0.25, 0) : 0,
        x: 0.2,
        y: 0.2,
        label: "",
      };

      const cavity = { ...base, label: formatCavityLabel(base) };

      const nextStack = prev.layout.stack.map((l) =>
        l.id !== prev.activeLayerId
          ? l
          : { ...l, cavities: [...l.cavities, cavity] },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...active.cavities],
        },
        activeLayerId: active.id,
      };
    });
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
          cavities: [...active.cavities],
        },
        activeLayerId: active.id,
      };
    });
    setSelectedId(null);
  }, []);

  const addLayer = useCallback(() => {
    setState((prev) => {
      const idx = prev.layout.stack.length + 1;
      const id = `layer-${idx}`;
      const nextStack = [
        ...prev.layout.stack,
        { id, label: `Layer ${idx}`, cavities: [] },
      ];

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [],
        },
        activeLayerId: id,
      };
    });
    setSelectedId(null);
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
          cavities: [...active.cavities],
        },
        activeLayerId: active.id,
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

/* ================= helpers ================= */

function normalizeInitialLayout(initial: LayoutModel): LayoutState {
  const block = { ...initial.block };

  // 🔒 If stack exists, IGNORE initial.cavities entirely
  if (Array.isArray((initial as any).stack) && (initial as any).stack.length) {
    const stack = (initial as any).stack.map((l: any) => ({
      id: l.id,
      label: l.label,
      cavities: [...l.cavities],
    }));

    return {
      layout: {
        block,
        stack,
        cavities: [...stack[0].cavities],
      },
      activeLayerId: stack[0].id,
    };
  }

  // Legacy: seed exactly one layer ONCE
  const layerId = "layer-1";
  const cavs = Array.isArray(initial.cavities) ? [...initial.cavities] : [];

  return {
    layout: {
      block,
      stack: [{ id: layerId, label: "Layer 1", cavities: cavs }],
      cavities: [...cavs],
    },
    activeLayerId: layerId,
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v || 0));
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

function formatCavityLabel(c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">) {
  const L = Math.round(c.lengthIn * 8) / 8;
  const W = Math.round(c.widthIn * 8) / 8;
  const D = Math.round(c.depthIn * 8) / 8;
  return c.shape === "circle" ? `Ø${L}×${D} in` : `${L}×${W}×${D} in`;
}
