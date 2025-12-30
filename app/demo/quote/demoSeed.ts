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

export type DemoScenarioId = "mailer" | "twoLayer" | "tray6";

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
    label: "Mailer insert (single layer)",
    subtitle: '15"×12"×2" with mixed cavities',
    materialLabel: "Expanded Polyethylene (EPE)",
    densityLabel: "1.7 lb/ft³",
    seed: {
      editorMode: "basic",
      block: { lengthIn: 15, widthIn: 12, thicknessIn: 2 } as any,
      cavities: [],
      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: 2,
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
              cornerRadiusIn: 0,
              x: 0.18,
              y: 0.62,
              label: "2.25×1.75×1 in",
            },
          ],
        } as any,
      ],
    } as any,
  },

  {
    id: "twoLayer",
    label: "Two-layer set (top pad + base)",
    subtitle: '15"×12" total — Advanced mode + rounded pocket + cropped corners',
    materialLabel: "Expanded Polyethylene (EPE)",
    densityLabel: "2.0 lb/ft³",
    seed: {
      // ADVANCED: demonstrates the advanced editor behavior (no spacing restrictions, etc.)
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
            // Rounded-rect pocket (advanced vibe)
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
            // Circle pocket (keep one secondary)
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

  {
    id: "tray6",
    label: "Tray with 6 pockets",
    subtitle: '16"×12"×2" with repeated cavities (spacing rules)',
    materialLabel: "Polyethylene (PE)",
    densityLabel: "1.7 lb/ft³",
    seed: {
      editorMode: "basic",
      block: { lengthIn: 16, widthIn: 12, thicknessIn: 2 } as any,
      cavities: [],
      stack: [
        {
          id: "layer-1",
          label: "Layer 1",
          thicknessIn: 2,
          cropCorners: false,
          cavities: [
            // 2×3 grid of pockets
            { id: "t1", shape: "rect", lengthIn: 3, widthIn: 3, depthIn: 1.25, cornerRadiusIn: 0, x: 0.10, y: 0.16, label: "3×3×1.25 in" },
            { id: "t2", shape: "rect", lengthIn: 3, widthIn: 3, depthIn: 1.25, cornerRadiusIn: 0, x: 0.35, y: 0.16, label: "3×3×1.25 in" },
            { id: "t3", shape: "rect", lengthIn: 3, widthIn: 3, depthIn: 1.25, cornerRadiusIn: 0, x: 0.60, y: 0.16, label: "3×3×1.25 in" },

            { id: "t4", shape: "rect", lengthIn: 3, widthIn: 3, depthIn: 1.25, cornerRadiusIn: 0, x: 0.10, y: 0.56, label: "3×3×1.25 in" },
            { id: "t5", shape: "rect", lengthIn: 3, widthIn: 3, depthIn: 1.25, cornerRadiusIn: 0, x: 0.35, y: 0.56, label: "3×3×1.25 in" },
            { id: "t6", shape: "rect", lengthIn: 3, widthIn: 3, depthIn: 1.25, cornerRadiusIn: 0, x: 0.60, y: 0.56, label: "3×3×1.25 in" },
          ],
        } as any,
      ],
    } as any,
  },
];

export function getScenario(id: DemoScenarioId): DemoScenario {
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? DEMO_SCENARIOS[0];
}
