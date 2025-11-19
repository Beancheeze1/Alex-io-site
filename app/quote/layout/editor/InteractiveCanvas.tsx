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

const WALL_MARGIN_IN = 0.5;

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

  // Block pixel dimensions (true proportional to inches).
  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  const blockOffset = {
    x: (canvasWidth - blockPx.width) / 2,
    y: (canvasHeight - blockPx.height) / 2,
  };

  // Inner keep-out rectangle (0.5" wall all around)
  const innerWidthIn = Math.max(0, block.lengthIn - 2 * WALL_MARGIN_IN);
  const innerHeightIn = Math.max(0, block.widthIn - 2 * WALL_MARGIN_IN);
  const innerWidthPx = innerWidthIn * scale;
  const innerHeightPx = innerHeightIn * scale;
  const innerX = blockOffset.x + WALL_MARGIN_IN * scale;
  const innerY = blockOffset.y + WALL_MARGIN_IN * scale;

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

    if (drag.kind === "resize") {
      // Resize mode: convert mouse delta to inches using the same scale.
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
        Drag cavities to adjust placement. Use the square handle at the
        bottom-right of each cavity to resize. Block and cavities are scaled
        in inches; a 0.5" wall is kept clear on all sides.
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
          {/* Block outline (square corners) */}
          <rect
            x={blockOffset.x}
            y={blockOffset.y}
            width={blockPx.width}
            height={blockPx.height}
            rx={0}
            ry={0}
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

          {/* Inner keep-out area for wall margin */}
          {innerWidthIn > 0 && innerHeightIn > 0 && (
            <rect
              x={innerX}
              y={innerY}
              width={innerWidthPx}
              height={innerHeightPx}
              rx={0}
              ry={0}
              fill="none"
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          {/* Cavities */}
          {layout.cavities.map((cavity) => {
            const isSelected = cavity.id === selectedId;

            // Size in px based on inches
            const cavWidth = cavity.lengthIn * scale;
            const cavHeight = cavity.widthIn * scale;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const handleSize = 12;
            const handleX = cavX + cavWidth - handleSize / 2;
            const handleY = cavY + cavHeight - handleSize / 2;

            // Circle uses min(width, height) as diameter
            const isCircle = cavity.shape === "circle";
            const isRoundRect = cavity.shape === "roundRect";

            const radiusPx =
              isCircle ? Math.min(cavWidth, cavHeight) / 2 : 0;
            const centerX = cavX + cavWidth / 2;
            const centerY = cavY + cavHeight / 2;

            const cornerRadiusPx =
              isRoundRect && cavity.cornerRadiusIn != null
                ? Math.min(
                    cavity.cornerRadiusIn * scale,
                    cavWidth / 2,
                    cavHeight / 2
                  )
                : 0;

            return (
              <g key={cavity.id}>
                {isCircle ? (
                  <circle
                    cx={centerX}
                    cy={centerY}
                    r={radiusPx}
                    fill={isSelected ? "#bfdbfe" : "#e5e7eb"}
                    stroke={isSelected ? "#1d4ed8" : "#9ca3af"}
                    strokeWidth={isSelected ? 2 : 1}
                    onMouseDown={(e) =>
                      handleCavityMouseDown(
                        // circle still uses rect area for dragging reference
                        e as unknown as MouseEvent<SVGRectElement>,
                        cavity
                      )
                    }
                  />
                ) : (
                  <rect
                    x={cavX}
                    y={cavY}
                    width={cavWidth}
                    height={cavHeight}
                    rx={cornerRadiusPx}
                    ry={cornerRadiusPx}
                    fill={isSelected ? "#bfdbfe" : "#e5e7eb"}
                    stroke={isSelected ? "#1d4ed8" : "#9ca3af"}
                    strokeWidth={isSelected ? 2 : 1}
                    onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                  />
                )}

                {/* Label inside cavity */}
                <text
                  x={centerX}
                  y={centerY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-700 text-[9px]"
                >
                  {cavity.lengthIn}×{cavity.widthIn}×{cavity.depthIn}"
                </text>

                {/* Resize handle – ALWAYS visible */}
                <rect
                  x={handleX}
                  y={handleY}
                  width={handleSize}
                  height={handleSize}
                  rx={3}
                  ry={3}
                  fill={isSelected ? "#1d4ed8" : "#bfdbfe"}
                  stroke={isSelected ? "#ffffff" : "#2563eb"}
                  strokeWidth={1}
                  onMouseDown={(e) => handleResizeMouseDown(e, cavity)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Proportional top-view layout — block and cavities are scaled to each
        other based on inch dimensions. A 0.5" wall is reserved around the
        block so cavities don&apos;t get too close to the edges. Resizing snaps
        length and width to 0.125" increments.
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
