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
//  - HARDENING: ensure cavity x/y are always finite so drag can never teleport to (0,0)
//  - NEW HARDENING (12/19): NEVER turn invalid x/y into 0 (upper-left teleport).
//    If an invalid coordinate reaches updateCavityPosition(), we keep the prior value.
//
// NEW (Path A, additive):
//  - Per-layer crop-corners toggle persisted on LayoutLayer.cropCorners
//  - Hook exposes setLayerCropCorners(id, value)
//  - Normalization preserves cropCorners if already present
//
// STEP 4 SAFETY RAILS (12/27):
//  - Preserve unknown/future fields on LayoutModel during normalization.
//    This ensures Advanced-only metadata can round-trip through the editor
//    without being silently dropped, even when the user is in Basic mode.

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

  // NEW (Path A): current editor mode (derived from layout.editorMode; defaults to "basic")
  editorMode: "basic" | "advanced";
  // Selection model:
  // - selectedIds[0] is the primary (anchor) selection
  // - selectedIds[1] is the secondary (Advanced-only multi-select)
  selectedIds: string[];
  // Back-compat alias for existing single-select UIs (primary selection)
  selectedId: string | null;
  activeLayerId: string;
  selectCavity: (id: string | null, opts?: { additive?: boolean }) => void;
  setActiveLayerId: (id: string) => void;

  // NEW (Path A): hydrate/replace the entire layout model WITHOUT remounting.
  // Used to load DB-backed layout after boot while preserving sticky selection state.
  replaceLayout: (
    next: LayoutModel,
    opts?: { preserveSelection?: boolean }
  ) => void;

  // NEW (Path A): editor mode (persisted in layout JSON)
  setEditorMode: (mode: "basic" | "advanced") => void;

  // NEW (Path A): per-layer cropped-corner toggle
  setLayerCropCorners: (layerId: string, cropCorners: boolean) => void;

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
    size?: {
      lengthIn: number;
      widthIn: number;
      depthIn: number;
      cornerRadiusIn?: number;
    },
  ) => void;

  deleteCavity: (id: string) => void;

  addLayer: () => void;
  renameLayer: (id: string, label: string) => void;
  deleteLayer: (id: string) => void;
};

export function useLayoutModel(initial: LayoutModel): UseLayoutModelResult {
  const [state, setState] = useState<LayoutState>(() =>
    normalizeInitialLayout(initial),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { layout, activeLayerId } = state;
  const selectedId = selectedIds[0] ?? null;

  const selectCavity = useCallback(
    (id: string | null, opts?: { additive?: boolean }) => {
      if (!id) {
        setSelectedIds([]);
        return;
      }

      const additive = !!opts?.additive;

      setSelectedIds((prev) => {
        if (!additive) return [id];

        // Toggle behavior with a max of 2 selected ids.
        // - If already selected, remove it.
        // - If 0 selected, add as primary.
        // - If 1 selected, add as secondary.
        // - If 2 selected, keep primary and replace secondary.
        if (prev.includes(id)) return prev.filter((x) => x !== id);

        if (prev.length === 0) return [id];
        if (prev.length === 1) return [prev[0], id];

        return [prev[0], id];
      });
    },
    [],
  );

const setActiveLayerId = useCallback((id: string) => {
    setState((prev) => {
      const layer =
        prev.layout.stack.find((l) => l.id === id) ?? prev.layout.stack[0];
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
    setSelectedIds([]);
  }, []);

  // NEW (Path A): editor mode persisted in layout JSON (defaults to "basic" when missing)
  const setEditorMode = useCallback((mode: "basic" | "advanced") => {
    setState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        editorMode: mode,
      },
    }));
  }, []);

  // NEW (Path A): set per-layer crop-corners flag
  const setLayerCropCorners = useCallback(
    (layerId: string, cropCorners: boolean) => {
      setState((prev) => {
        const nextStack = prev.layout.stack.map((l) =>
          l.id === layerId ? { ...l, cropCorners: !!cropCorners } : l,
        );

        return {
          ...prev,
          layout: {
            ...prev.layout,
            stack: nextStack,
          },
        };
      });
    },
    [],
  );
  // NEW (Path A): hydrate/replace the whole layout without remounting this hook.
  const replaceLayout = useCallback(
    (next: LayoutModel, opts?: { preserveSelection?: boolean }) => {
      const preserveSelection = opts?.preserveSelection !== false;

      const nextState = normalizeInitialLayout(next);

      setState(() => nextState);

      if (!preserveSelection) {
        setSelectedIds([]);
        return;
      }

      // Keep only selections that still exist in the incoming layout.
      const idSet = new Set<string>();
      for (const layer of nextState.layout.stack ?? []) {
        for (const c of (layer as any).cavities ?? []) {
          if (c && typeof c.id === "string") idSet.add(c.id);
        }
      }

      setSelectedIds((prev) => prev.filter((id) => idSet.has(id)));
    },
    [],
  );



  const updateCavityPosition = useCallback((id: string, x: number, y: number) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((layer) =>
        layer.id !== prev.activeLayerId
          ? layer
          : {
              ...layer,
              cavities: layer.cavities.map((c) => {
                if (c.id !== id) return c;

                // CRITICAL HARDENING:
                // If x/y are invalid (NaN/Infinity/undefined), DO NOT turn them into 0.
                // Keep the prior value to prevent "teleport to upper-left".
                const nextX = clamp01OrKeep(x, (c as any).x);
                const nextY = clamp01OrKeep(y, (c as any).y);

                return { ...c, x: nextX, y: nextY };
              }),
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

    let newId: string | null = null;

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
      newId = cavity.id;

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

    // ✅ STICKY SELECTION: select newly created cavity
    if (newId) {
      setSelectedIds([newId]);
    }
  }, []);

  const deleteCavity = useCallback((id: string) => {
    setState((prev) => {
      const nextStack = prev.layout.stack.map((l) => ({
        ...l,
        cavities: l.cavities.filter((c) => c.id !== id),
      }));

      const active =
        nextStack.find((l) => l.id === prev.activeLayerId) ?? nextStack[0];
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

    // ✅ Only clear selection if the deleted cavity was selected
    setSelectedIds((prev) => (prev.includes(id) ? [] : prev));
  }, []);


  const addLayer = useCallback(() => {
    setState((prev) => {
      const idx = prev.layout.stack.length + 1;
      const id = `layer-${idx}`;
      const nextStack = [
        ...prev.layout.stack,
        { id, label: `Layer ${idx}`, thicknessIn: 1, cavities: [], cropCorners: false },
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
    setSelectedIds([]);
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
    setSelectedIds([]);
  }, []);

  return {
    layout,

    // NEW (Path A): expose current editor mode for the UI toggle
    editorMode: layout.editorMode ?? "basic",

    selectedIds,
    selectedId,
    activeLayerId,
    selectCavity,
    setActiveLayerId,
  replaceLayout,
    setEditorMode,
    setLayerCropCorners,

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
  // STEP 4 SAFETY RAIL:
  // Preserve unknown / future LayoutModel fields so Advanced-only metadata can round-trip.
  // We normalize the fields we know, but we DO NOT drop additional keys.
  const { block: _b, cavities: _c, stack: _s, editorMode: _m, ...rest } =
    (initial as any) ?? {};

  const block = { ...(initial as any).block };

  const editorMode: "basic" | "advanced" =
    (initial as any).editorMode === "advanced" ? "advanced" : "basic";

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

          // HARDENING: x/y must always be finite; otherwise drag math can produce NaN
          // which clamp01() turns into 0 => teleport to the corner.
          (next as any).x = clamp01Or((next as any).x, 0.2);
          (next as any).y = clamp01Or((next as any).y, 0.2);

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

        // NEW (Path A): preserve per-layer crop-corners flag if present
        cropCorners: !!l.cropCorners,
      };
    }) as LayoutLayer[];

    const active = stack[0];
    const mirrored = dedupeCavities(active.cavities);

    return {
      layout: {
        ...rest,
        block: {
          ...block,
          thicknessIn: safeInch(active.thicknessIn ?? block.thicknessIn ?? 1, 0.5),
        },
        stack,
        cavities: [...mirrored],
        editorMode,
      },
      activeLayerId: active.id,
    };
  }

  const cavsRaw = Array.isArray((initial as any).cavities) ? [...(initial as any).cavities] : [];

  // Legacy single-layer fallback:
  // If the incoming model does NOT include a stack, we treat it as a single-piece
  // layout (even if it has cavities). Multi-layer layouts must provide `stack`.
  if (cavsRaw.length) {
    // Seed stable IDs to prevent phantom duplicates on mount
    const seeded = cavsRaw.map((c, i) => ({
      ...c,
      id: `seed-cav-${i + 1}`,
      // HARDENING: ensure x/y exist on legacy cavities too
      x: clamp01Or((c as any).x, 0.2),
      y: clamp01Or((c as any).y, 0.2),
    }));
    const cavs = dedupeCavities(seeded);

    const thickness = safeInch(block.thicknessIn ?? 1, 0.5);
    const stack: LayoutLayer[] = [
      {
        id: "layer-1",
        label: "Layer 1",
        thicknessIn: thickness,
        cavities: cavs,

        // NEW (Path A): legacy defaults to square corners
        cropCorners: false,
      },
    ];

    return {
      layout: {
        ...rest,
        block: { ...block, thicknessIn: thickness },
        stack,
        cavities: [...cavs],
        editorMode,
      },
      activeLayerId: "layer-1",
    };
  }

  // Legacy single-layer fallback
  return {
    layout: {
      ...rest,
      block: { ...block, thicknessIn: safeInch(block.thicknessIn ?? 1, 0.5) },
      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: safeInch(block.thicknessIn ?? 1, 0.5),
          cavities: [],
          cropCorners: false,
        },
      ],
      cavities: [],
      editorMode,
    },
    activeLayerId: "layer-1",
  };
}

function cavitySig(c: Cavity) {
  // Signature used for de-dupe fallback: shape + dims + corner radius (rounded to 1/8")
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
  // IMPORTANT:
  // We must allow multiple cavities with identical dimensions (common in packaging).
  // So we de-dupe by stable `id` first. Only fall back to a dims signature when `id` is missing.
  const seen = new Set<string>();
  const out: Cavity[] = [];

  for (const c of list || []) {
    const id = String((c as any)?.id ?? "").trim();
    const key = id ? `id:${id}` : `sig:${cavitySig(c)}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // HARDENING: final safety — x/y should never be missing in state
    (c as any).x = clamp01Or((c as any).x, 0.2);
    (c as any).y = clamp01Or((c as any).y, 0.2);

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
  // keep existing behavior for normal numeric inputs
  return Math.max(0, Math.min(1, v || 0));
}

function clamp01Or(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return clamp01(fallback);
  return clamp01(n);
}

// NEW: keep prior value when incoming coordinate is invalid
function clamp01OrKeep(v: any, prior: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    const p = Number(prior);
    if (Number.isFinite(p)) return clamp01(p);
    return clamp01(0.2);
  }
  return clamp01(n);
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

  // ✅ NEW (Path A): allow UI to persist corner intent
  // (kept permissive + additive; if undefined, no change)
  if (p.cornerStyle != null) {
    const cs = String(p.cornerStyle);
    if (cs === "square" || cs === "chamfer") {
      (o as any).cornerStyle = cs;
    }
  }
  if ((p as any).chamferIn != null) {
    const n = Number((p as any).chamferIn);
    if (Number.isFinite(n) && n >= 0) {
      (o as any).chamferIn = safeInch(n, 0);
    }
  }

  return o;
}

function normalizeCavityPatch(p: Partial<Cavity>) {
  const o: Partial<Cavity> = {};
  if (p.lengthIn != null) o.lengthIn = safeInch(p.lengthIn, 0.25);
  if (p.widthIn != null) o.widthIn = safeInch(p.widthIn, 0.25);
  if (p.depthIn != null) o.depthIn = safeInch(p.depthIn, 0.25);
  if (p.cornerRadiusIn != null) o.cornerRadiusIn = safeInch(p.cornerRadiusIn, 0);
  if (p.label != null) o.label = p.label;
  // NOTE: we do NOT allow editing x/y here — movement goes through updateCavityPosition()
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
