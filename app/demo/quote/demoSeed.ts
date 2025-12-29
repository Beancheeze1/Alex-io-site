// app/demo/quote/demoSeed.ts
//
// Static seed model for the Demo Quote.
// No backend calls. No quote numbers. Always works.
//
// Locked demo layout spec:
// - Block: 18" × 12" × 2" (single layer)
// - Cavities (3):
//   - Rect: 6" × 4" × 1.5"
//   - Circle: Ø3" × 1.5"
//   - Rect: 2.5" × 2" × 1.0"
//
// NOTE: x/y are normalized 0..1 values used by the editor (top-left origin in UI).
//

import type { LayoutModel } from "../../quote/layout/editor/layoutTypes";

export function getDemoLayoutSeed(): LayoutModel {
  return {
    editorMode: "basic",
    block: {
      lengthIn: 18,
      widthIn: 12,
      thicknessIn: 2,
    } as any,

    // useLayoutModel() will mirror active layer cavities here automatically
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
            lengthIn: 6,
            widthIn: 4,
            depthIn: 1.5,
            cornerRadiusIn: 0,
            x: 0.14,
            y: 0.18,
            label: "6×4×1.5 in",
          },
          {
            id: "demo-cav-b",
            shape: "circle",
            // For circle, InteractiveCanvas uses lengthIn as diameter.
            lengthIn: 3,
            widthIn: 3,
            depthIn: 1.5,
            cornerRadiusIn: 0,
            x: 0.68,
            y: 0.34,
            label: "Ø3×1.5 in",
          },
          {
            id: "demo-cav-c",
            shape: "rect",
            lengthIn: 2.5,
            widthIn: 2,
            depthIn: 1,
            cornerRadiusIn: 0,
            x: 0.20,
            y: 0.62,
            label: "2.5×2×1 in",
          },
        ],
      } as any,
    ],
  } as any;
}
