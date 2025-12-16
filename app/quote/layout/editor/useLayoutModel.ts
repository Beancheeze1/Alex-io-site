"use client";

import { useState, useCallback } from "react";
import type {
  BlockDims,
  LayoutModel,
  Cavity,
  CavityShape,
  LayoutLayer,
} from "./layoutTypes";

type LayoutState = {
  layout: LayoutModel & { stack: LayoutLayer[] };
  activeLayerId: string;
};

export type UseLayoutModelResult = {
  layout: LayoutModel & { stack: LayoutLayer[] };
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
      const mirrored = dedupeCavities(layer.cavities);

      return {
        layout: {
          ...prev.layout,
          block: { ...prev.layout.block, thicknessIn: safeInch(layer.thicknessIn, 0.5) },
          cavities: [...mirrored],
        },
        activeLayerId: layer.id,
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
    updateCavityPosition: () => {},
    updateBlockDims: () => {},
    updateCavityDims: () => {},
    addCavity: () => {},
    deleteCavity: () => {},
    addLayer: () => {},
    renameLayer: () => {},
    deleteLayer: () => {},
  };
}

/* ================= FIX ================= */

function normalizeInitialLayout(initial: LayoutModel): LayoutState {
  const block = { ...initial.block };

  // ✅ FIX: honor inferred multi-layer intent BEFORE collapsing to single layer
  if (Array.isArray((initial as any).layers) && (initial as any).layers.length > 1) {
    const stack: LayoutLayer[] = (initial as any).layers.map((l: any, i: number) => ({
      id: `layer-${i + 1}`,
      label: l.label || `Layer ${i + 1}`,
      thicknessIn: safeInch(l.thicknessIn ?? l.thickness ?? 1, 0.5),
      cavities: [],
    }));

    const active = stack[0];

    return {
      layout: {
        block: {
          ...block,
          thicknessIn: stack.reduce((s, l) => s + l.thicknessIn, 0),
        },
        stack,
        cavities: [],
      },
      activeLayerId: active.id,
    };
  }

  // --- existing single-layer behavior (UNCHANGED) ---
  const thickness = safeInch(block.thicknessIn ?? 1, 0.5);

  return {
    layout: {
      block: { ...block, thicknessIn: thickness },
      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: thickness,
          cavities: [],
        },
      ],
      cavities: [],
    },
    activeLayerId: "layer-1",
  };
}

/* ================= helpers ================= */

function dedupeCavities(list: Cavity[]) {
  const seen = new Set<string>();
  const out: Cavity[] = [];
  for (const c of list || []) {
    const k = `${c.shape}-${c.lengthIn}-${c.widthIn}-${c.depthIn}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function safeInch(v: number | undefined, min: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.round(n * 8) / 8);
}
