// app/quote/layout/editor/useLayoutModel.ts
//
// React hook for managing the layout model in the browser.
// HARDENED:
//  - Infers layers + thickness from email intent on first open
//  - Single source of truth for cavities = stack[layer].cavities
//  - layout.cavities ALWAYS mirrors active layer (never seeded)
//  - Seeded cavities use stable ids (seed-cav-*) to prevent phantom duplication
//  - De-dupes cavities defensively when mirroring active layer
//  - Mirrors active layer thickness into layout.block.thicknessIn for UI controls
//  - Legacy layouts normalized exactly once
//  - Path A safe

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
    size?: { lengthIn: number; widthIn: number; depthIn: number; cornerRadiusIn?: number }
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
          // Mirror active layer thickness into block.thicknessIn for UI that binds to block dims
          block: { ...prev.layout.block, thicknessIn: safeInch(layer.thicknessIn, 0.5) },
          cavities: [...mirrored],
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
      const mirrored = dedupeCavities(active.cavities);

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...mirrored],
        },
        activeLayerId: active.id,
      };
    });
  }, []);

  const updateBlockDims = useCallback((patch: Partial<BlockDims>) => {
    setState((prev) => {
      const nextBlock = {
        ...prev.layout.block,
        ...normalizeBlockPatch(patch),
      };

      // If thicknessIn was changed via UI, apply it to the active layer thickness too.
      const nextStack =
        patch.thicknessIn == null
          ? prev.layout.stack
          : prev.layout.stack.map((l) =>
              l.id !== prev.activeLayerId
                ? l
                : { ...l, thicknessIn: safeInch(patch.thicknessIn, 0.5) },
            );

      return {
        ...prev,
        layout: {
          ...prev.layout,
          block: nextBlock,
          stack: nextStack,
        },
      };
    });
  }, []);

  const updateCavityDims = useCallback((id: string, patch: Partial<Cavity>) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((layer) =>
        layer.id !== prev.activeLayerId
          ? layer
          : {
              ...layer,
              cavities: layer.cavities.map((c) =>
                c.id !== id ? c : { ...c, ...normalizeCavityPatch(patch) },
              ),
            },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;
      const mirrored = dedupeCavities(active.cavities);

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...mirrored],
        },
        activeLayerId: active.id,
      };
    });
  }, []);

  const addCavity = useCallback((shape: CavityShape, size: any) => {
    const s = size ?? { lengthIn: 2, widthIn: 2, depthIn: 1, cornerRadiusIn: 0 };

    setState((prev) => {
      const nextN = nextCavityNumber(prev.layout.stack);

      const base: Cavity = {
        id: `cav-${nextN}`,
        shape,
        lengthIn: safeInch(s.lengthIn, 0.5),
        widthIn: safeInch(s.widthIn, 0.5),
        depthIn: safeInch(s.depthIn, 0.5),
        cornerRadiusIn:
          shape === "roundedRect" ? safeInch(s.cornerRadiusIn ?? 0.25, 0) : 0,
        x: 0.2,
        y: 0.2,
        label: "",
      };

      const cavity = { ...base, label: formatCavityLabel(base) };

      const nextStack = prev.layout.stack.map((l) =>
        l.id !== prev.activeLayerId ? l : { ...l, cavities: [...l.cavities, cavity] },
      );

      const active = nextStack.find((l) => l.id === prev.activeLayerId)!;
      const mirrored = dedupeCavities(active.cavities);

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...mirrored],
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

      const active = nextStack.find((l) => l.id === prev.activeLayerId) ?? nextStack[0];
      const mirrored = dedupeCavities(active.cavities);

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          cavities: [...mirrored],
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
        { id, label: `Layer ${idx}`, thicknessIn: 1, cavities: [] },
      ];

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          block: { ...prev.layout.block, thicknessIn: 1 }, // mirror new active thickness
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
      const active = nextStack.find((l) => l.id === prev.activeLayerId) ?? nextStack[0];
      const mirrored = dedupeCavities(active.cavities);

      return {
        layout: {
          ...prev.layout,
          stack: nextStack,
          block: { ...prev.layout.block, thicknessIn: safeInch(active.thicknessIn, 0.5) },
          cavities: [...mirrored],
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

  // Trust pre-existing stack fully
  if (Array.isArray((initial as any).stack) && (initial as any).stack.length) {
    // IMPORTANT:
    // Cavity ids must be globally unique across the entire stack.
    // If two layers both contain "cav-1", React key reuse can cause visual "teleporting"
    // when switching layers (you see the other layer's last position).
    const seenIds = new Set<string>();

    // Find current max numeric id so we can generate new ids only when needed.
    let maxNum = 0;
    for (const l of (initial as any).stack) {
      for (const c of (l?.cavities ?? []) as Cavity[]) {
        const m = String((c as any)?.id ?? "").match(/(?:seed-cav-|cav-)(\d+)/);
        if (m) maxNum = Math.max(maxNum, Number(m[1]) || 0);
      }
    }

    const stack = (initial as any).stack.map((l: any) => {
      const cavsIn = (l.cavities ?? []) as Cavity[];

      const cavs = dedupeCavities(
        cavsIn.map((c: Cavity) => {
          const next = { ...c } as Cavity;

          let id = String((next as any).id ?? "").trim();
          if (!id || seenIds.has(id)) {
            // Assign a new globally-unique cav-N id (only when duplicate/missing)
            maxNum += 1;
            id = `cav-${maxNum}`;
            (next as any).id = id;
          }

          seenIds.add(id);
          return next;
        }),
      );

      return {
        id: l.id,
        label: l.label,
        thicknessIn: l.thicknessIn,
        cavities: cavs,
      };
    }) as LayoutLayer[];

    const active = stack[0];
    const mirrored = dedupeCavities(active.cavities);

    return {
      layout: {
        block: {
          ...block,
          thicknessIn: safeInch(active.thicknessIn ?? block.thicknessIn ?? 1, 0.5),
        },
        stack,
        cavities: [...mirrored],
      },
      activeLayerId: active.id,
    };
  }

  const cavsRaw = Array.isArray(initial.cavities) ? [...initial.cavities] : [];

  // Legacy single-layer fallback:
  // If the incoming model does NOT include a stack, we treat it as a single-piece
  // layout (even if it has cavities). Multi-layer layouts must provide `stack`.
  if (cavsRaw.length) {
    // Seed stable IDs to prevent phantom duplicates on mount
    const seeded = cavsRaw.map((c, i) => ({ ...c, id: `seed-cav-${i + 1}` }));
    const cavs = dedupeCavities(seeded);

    const thickness = safeInch(block.thicknessIn ?? 1, 0.5);
    const stack: LayoutLayer[] = [
      {
        id: "layer-1",
        label: "Layer 1",
        thicknessIn: thickness,
        cavities: cavs,
      },
    ];

    return {
      layout: {
        block: { ...block, thicknessIn: thickness },
        stack,
        cavities: [...cavs],
      },
      activeLayerId: "layer-1",
    };
  }

  // Legacy single-layer fallback
  return {
    layout: {
      block: { ...block, thicknessIn: safeInch(block.thicknessIn ?? 1, 0.5) },
      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: safeInch(block.thicknessIn ?? 1, 0.5),
          cavities: [],
        },
      ],
      cavities: [],
    },
    activeLayerId: "layer-1",
  };
}

function cavitySig(c: Cavity) {
  // Signature used for de-dupe: shape + dims + corner radius (rounded to 1/8")
  const r8 = (n: number) => Math.round((Number(n) || 0) * 8) / 8;
  return [
    c.shape,
    r8(c.lengthIn),
    r8(c.widthIn),
    r8(c.depthIn),
    r8((c as any).cornerRadiusIn ?? 0),
  ].join("|");
}

function dedupeCavities(list: Cavity[]) {
  const seen = new Set<string>();
  const out: Cavity[] = [];
  for (const c of list || []) {
    const k = cavitySig(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function nextCavityNumber(stack: LayoutLayer[]) {
  let max = 0;
  for (const layer of stack) {
    for (const c of layer.cavities) {
      const m = String(c.id || "").match(/(?:seed-cav-|cav-)(\d+)/);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    }
  }
  return max + 1;
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

function formatCavityLabel(
  c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">,
) {
  const L = Math.round(c.lengthIn * 8) / 8;
  const W = Math.round(c.widthIn * 8) / 8;
  const D = Math.round(c.depthIn * 8) / 8;
  return c.shape === "circle" ? `Ø${L}×${D} in` : `${L}×${W}×${D} in`;
}
