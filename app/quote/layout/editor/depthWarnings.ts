// app/quote/layout/editor/depthWarnings.ts
//
// Early warning for STL-imported cavities whose depth could not be
// confirmed from the mesh (see computeCavityFloorDepths in
// lib/stl/processor.ts -- a genuine multi-level floor, or no floor data
// found at all). Those cavities keep a placeholder depthIn so the layout
// still renders/exports, but a rep should not treat that number as real
// until they've checked it -- surfaced here the same way the spacing
// guard (spacingWarnings.ts) is, rather than silently trusting a default.

import type { Cavity } from "./layoutTypes";

export type UnconfirmedDepthWarning = {
  cavityId: string;
  cavityLabel: string;
};

export function findUnconfirmedDepthCavities(cavities: Cavity[]): UnconfirmedDepthWarning[] {
  if (!Array.isArray(cavities)) return [];
  return cavities
    .filter((c) => c.depthSource === "unconfirmed")
    .map((c) => ({ cavityId: c.id, cavityLabel: c.label }));
}
