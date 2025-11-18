// app/quote/layout/editor/InteractiveCanvas.tsx
//
// SVG-based canvas that can render the block + cavities
// and supports click-to-select, drag-to-move, and drag-to-resize.
//
// This is wired by the parent via LayoutModel + callbacks.

"use client";

import { useRef, useState, MouseEvent } from "react";
import type { LayoutModel, Cavity } from "./layoutTypes";

type Props = {
  layout: LayoutModel;
  selectedId: string | null;
  // renamed to avoid Next.js "on*" Server Action warning
  selectAction: (id: string | null) => void;
  /**
   * Multi-purpose:
   *  - move:   moveAction("cav-1", xNorm, yNorm)
   *  - resize: moveAction("resize:cav-1", lengthNorm, widthNorm)
   */
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
};

type DragState =
  | {
      kind: "move";
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "resize";
      id: string;
      startMouseX: number;
      startMouseY: number;
      startLengthIn: number;
      startWidthIn: number;
    }
  | null;

export default function InteractiveCanvas({
  layout,
  selectedId,
  selectAction,
  moveAction,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  // Fixed canvas size in px; we scale model into this.
  const canvasWidth = 480;
  const canvasHeight = 300;

  const { block } = layout;
  const scale = calcScale(
    block.lengthIn,
    block.widthIn,
    canvasWidth,
    canvasHeight
  );

  // Block pixel dimensions (directly from inches × scale)
  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  const blockOffset = {
    x: (canvasWidth - blockPx.width) / 2,
    y: (canvasHeight - blockPx.height) / 2,
  };

  const handleCavityMouseDown = (
    e: MouseEvent<SVGRectElement>,
    cavity: Cavity
  ) => {
    e.stopPropagation();
    if (!svgRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    const cavX = blockOffset.x + cavity.x * blockPx.width;
    const cavY = blockOffset.y + cavity.y * blockPx.height;

    setDrag({
      kind: "move",
      id: cavity.id,
      offsetX: ptX - cavX,
      offsetY: ptY - cavY,
    });
    selectAction(cavity.id);
  };

  const handleResizeMouseDown = (e: MouseEvent<SVGRectElement>, cavity: Cavity) => {
    e.stopPropagation();
    if (!svgRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    setDrag({
      kind: "resize",
      id: cavity.id,
      startMouseX: ptX,
      startMouseY: ptY,
      startLengthIn: cavity.lengthIn,
      startWidthIn: cavity.widthIn,
    });
    selectAction(cavity.id);
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    if (drag.kind === "move") {
      const cavX = ptX - drag.offsetX;
      const cavY = ptY - drag.offsetY;

      const xNorm = (cavX - blockOffset.x) / blockPx.width;
      const yNorm = (cavY - blockOffset.y) / blockPx.height;

      moveAction(drag.id, xNorm, yNorm);
      return;
    }

    // Resize mode: convert mouse delta to inches using the same scale.
    if (drag.kind === "resize") {
      const deltaXpx = ptX - drag.startMouseX;
      const deltaYpx = ptY - drag.startMouseY;

      const deltaLIn = deltaXpx / scale;
      const deltaWIn = deltaYpx / scale;

      const newLength = Math.max(0.25, drag.startLengthIn + deltaLIn);
      const newWidth = Math.max(0.25, drag.startWidthIn + deltaWIn);

      const lengthNorm = newLength / (block.lengthIn || 1);
      const widthNorm = newWidth / (block.widthIn || 1);

      moveAction(`resize:${drag.id}`, lengthNorm, widthNorm);
      return;
    }
  };

  const handleMouseUp = () => {
    setDrag(null);
  };

  const handleBackgroundClick = () => {
    selectAction(null);
  };

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
      <div className="mb-2 text-xs font-medium text-slate-600">
        Drag cavities to adjust placement, or drag the small handle at the
        corner to resize. The drawing is a top view, scaled to the block’s
        length and width in inches.
      </div>

      <div className="overflow-hidden rounded-xl bg-white">
        <svg
          ref={svgRef}
          width={canvasWidth}
          height={canvasHeight}
          className="block w-full max-w-full"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleBackgroundClick}
        >
          {/* Block outline */}
          <rect
            x={blockOffset.x}
            y={blockOffset.y}
            width={blockPx.width}
            height={blockPx.height}
            rx={12}
            ry={12}
            fill="#eef2ff"
            stroke="#c7d2fe"
            strokeWidth={2}
          />
          <text
            x={blockOffset.x + blockPx.width / 2}
            y={blockOffset.y - 8}
            textAnchor="middle"
            className="fill-slate-600 text-[10px]"
          >
            Block: {block.lengthIn}×{block.widthIn}×{block.thicknessIn}" thick
          </text>

          {/* Cavities */}
          {layout.cavities.map((cavity) => {
            // Physical to pixel using scale (true proportional to inches).
            const cavWidth = cavity.lengthIn * scale;
            const cavHeight = cavity.widthIn * scale;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const isSelected = cavity.id === selectedId;

            // Resize handle (bottom-right corner)
            const handleSize = 10;
            const handleX = cavX + cavWidth - handleSize / 2;
            const handleY = cavY + cavHeight - handleSize / 2;

            return (
              <g key={cavity.id}>
                <rect
                  x={cavX}
                  y={cavY}
                  width={cavWidth}
                  height={cavHeight}
                  rx={8}
                  ry={8}
                  fill={isSelected ? "#bfdbfe" : "#e5e7eb"}
                  stroke={isSelected ? "#1d4ed8" : "#9ca3af"}
                  strokeWidth={isSelected ? 2 : 1}
                  onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                />
                {/* Label inside cavity */}
                <text
                  x={cavX + cavWidth / 2}
                  y={cavY + cavHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-700 text-[9px]"
                >
                  {cavity.lengthIn}×{cavity.widthIn}×{cavity.depthIn}"
                </text>

                {/* Resize handle (only show when selected to keep it clean) */}
                {isSelected && (
                  <rect
                    x={handleX}
                    y={handleY}
                    width={handleSize}
                    height={handleSize}
                    rx={3}
                    ry={3}
                    fill="#1d4ed8"
                    stroke="#ffffff"
                    strokeWidth={1}
                    onMouseDown={(e) => handleResizeMouseDown(e, cavity)}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Proportional top-view layout — block and cavities are scaled to each
        other based on their inch dimensions. Great for quick visual checks
        before going to full CAD.
      </div>
    </div>
  );
}

function calcScale(
  lenIn: number,
  widthIn: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  if (!lenIn || !widthIn) return 1;
  const padding = 40;
  const availableW = canvasWidth - padding * 2;
  const availableH = canvasHeight - padding * 2;

  const sx = availableW / lenIn;
  const sy = availableH / widthIn;
  return Math.min(sx, sy);
}
