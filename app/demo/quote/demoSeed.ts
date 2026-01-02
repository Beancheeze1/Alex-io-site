// app/demo/quote/demoSeed.ts
//
// Demo scenarios (100% local, never hits backend).
// Used by /demo/quote to make the demo feel like a real product.
//
// IMPORTANT:
// - Keep Polyethylene vs Expanded Polyethylene distinct in wording.
// - These are display-only in the demo (no pricing engine here).
//

import type { LayoutModel } from "../../quote/layout/editor/layoutTypes";

// Only keep 2 scenarios now.
export type DemoScenarioId = "mailer" | "twoLayer";

export type DemoScenario = {
  id: DemoScenarioId;
  label: string;
  subtitle: string;
  materialLabel: string; // display-only
  densityLabel: string; // display-only
  seed: LayoutModel;
};

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "mailer",
    label: "Basic editor",
    subtitle: '15"×12"×2" with mixed cavities',
    materialLabel: "Expanded Polyethylene (EPE)",
    densityLabel: "1.7 lb/ft³",
    seed: {
      editorMode: "basic",
      block: { lengthIn: 15, widthIn: 12, thicknessIn: 2 } as any,

      // NOTE:
      // The editor/hook mirrors cavities from the ACTIVE LAYER in stack[] into layout.cavities.
      // To guarantee the demo always shows cavities, we:
      //  - Provide TWO layers (total thickness still = 2")
      //  - Put the demo cavities on Layer 2 (common default active layer)
      //  - Add active-layer hints set to 2 (safe no-ops if unused)
      //
      // Keep layout.cavities populated too (best-effort), but do not rely on it.
      cavities: [
        {
          id: "demo-cav-a",
          shape: "rect",
          lengthIn: 5.25,
          widthIn: 3.5,
          depthIn: 1.5,
          cornerRadiusIn: 0,
          x: 0.12,
          y: 0.18,
          label: "5.25×3.5×1.5 in",
        },
        {
          id: "demo-cav-b",
          shape: "circle",
          lengthIn: 2.75,
          widthIn: 2.75,
          depthIn: 1.5,
          cornerRadiusIn: 0,
          x: 0.70,
          y: 0.34,
          label: "Ø2.75×1.5 in",
        },
        {
          id: "demo-cav-c",
          shape: "rect",
          lengthIn: 2.25,
          widthIn: 1.75,
          depthIn: 1,
          // Rounded-corner cavity (requested for demo)
          cornerRadiusIn: 0.25,
          x: 0.18,
          y: 0.62,
          label: "2.25×1.75×1 in (R0.25)",
        },
      ],

      // Active-layer hints (safe even if ignored by the hook)
      activeLayer: 2 as any,
      active_layer: 2 as any,
      layer_cavity_layer_index: 2 as any,

      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: 1,
          cropCorners: false,
          cavities: [],
        } as any,
        {
          id: "layer-2",
          label: "Layer 2",
          thicknessIn: 1,
          cropCorners: false,
          cavities: [
            {
              id: "demo-cav-a",
              shape: "rect",
              lengthIn: 5.25,
              widthIn: 3.5,
              depthIn: 1.5,
              cornerRadiusIn: 0,
              x: 0.12,
              y: 0.18,
              label: "5.25×3.5×1.5 in",
            },
            {
              id: "demo-cav-b",
              shape: "circle",
              lengthIn: 2.75,
              widthIn: 2.75,
              depthIn: 1.5,
              cornerRadiusIn: 0,
              x: 0.70,
              y: 0.34,
              label: "Ø2.75×1.5 in",
            },
            {
              id: "demo-cav-c",
              shape: "rect",
              lengthIn: 2.25,
              widthIn: 1.75,
              depthIn: 1,
              cornerRadiusIn: 0.25,
              x: 0.18,
              y: 0.62,
              label: "2.25×1.75×1 in (R0.25)",
            },
          ],
        } as any,
      ],
    } as any,
  },

  {
    id: "twoLayer",
    label: "Advanced editor",
    subtitle: '15"×12" total — Advanced mode + rounded pocket + cropped corners',
    materialLabel: "Expanded Polyethylene (EPE)",
    densityLabel: "2.0 lb/ft³",
    seed: {
      editorMode: "advanced",
      block: { lengthIn: 15, widthIn: 12, thicknessIn: 2 } as any,
      cavities: [],
      stack: [
        {
          id: "layer-1",
          label: "Top pad",
          thicknessIn: 0.5,
          cropCorners: true,
          cavities: [],
        } as any,
        {
          id: "layer-2",
          label: "Base",
          thicknessIn: 1.5,
          cropCorners: false,
          cavities: [
            {
              id: "demo2-cav-a",
              shape: "rect",
              lengthIn: 5.75,
              widthIn: 3.75,
              depthIn: 1.5,
              cornerRadiusIn: 0.25,
              x: 0.12,
              y: 0.20,
              label: "5.75×3.75×1.5 in (R0.25)",
            },
            {
              id: "demo2-cav-b",
              shape: "circle",
              lengthIn: 2.5,
              widthIn: 2.5,
              depthIn: 1.5,
              cornerRadiusIn: 0,
              x: 0.72,
              y: 0.40,
              label: "Ø2.5×1.5 in",
            },
          ],
        } as any,
      ],
    } as any,
  },
];

export function getScenario(id: DemoScenarioId): DemoScenario {
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? DEMO_SCENARIOS[0];
}
