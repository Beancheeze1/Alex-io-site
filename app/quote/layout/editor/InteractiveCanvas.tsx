// app/quote/layout/editor/InteractiveCanvas.tsx
//
// SVG-based canvas that can render the block + cavities
// with simple click-to-select, drag-to-move, and resize handle.
//
// This is used by app/quote/layout/page.tsx and expects a LayoutModel.

"use client";

import { useRef, useState, MouseEvent } from "react";
import type { LayoutModel, Cavity } from "./layoutTypes";
import { WALL_MARGIN_IN } from "./layoutTypes";

type Props = {
  layout: LayoutModel;
  selectedId: string | null;
  // Named without "on*" to avoid Next.js Server Action warnings.
  selectAction: (id: string | null) => void;
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
  resizeAction: (id: string, lengthIn: number, widthIn: number) => void;
};

type DragMode = "move" | "resize";

type DragState =
  | {
      id: string;
      mode: DragMode;
      offsetX: number;
      offsetY: number;
    }
  | null;

export default function InteractiveCanvas({
  layout,
  selectedId,
  selectAction,
  moveAction,
  resizeAction,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  // Fixed canvas size in px; we scale model into this.
  const canvasWidth = 640;
  const canvasHeight = 420;

  const { block } = layout;
  const scale = calcScale(
    block.lengthIn,
    block.widthIn,
    canvasWidth,
    canvasHeight
  );

  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  const blockOffset = {
    x: (canvasWidth - blockPx.width) / 2,
    y: (canvasHeight - blockPx.height) / 2,
  };

  const wallMarginPx = WALL_MARGIN_IN * scale;

  const innerBlock = {
    x: blockOffset.x + wallMarginPx,
    y: blockOffset.y + wallMarginPx,
    width: Math.max(0, blockPx.width - wallMarginPx * 2),
    height: Math.max(0, blockPx.height - wallMarginPx * 2),
  };

  const gridSpacingIn = 0.5; // 1/2" grid
  const gridSpacingPx = gridSpacingIn * scale;

  const handleCanvasMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    if (drag.mode === "move") {
      const cav = layout.cavities.find((c) => c.id === drag.id);
      if (!cav) return;

      const cavX = ptX - drag.offsetX;
      const cavY = ptY - drag.offsetY;

      const xNorm = (cavX - blockOffset.x) / blockPx.width;
      const yNorm = (cavY - blockOffset.y) / blockPx.height;

      moveAction(drag.id, xNorm, yNorm);
    } else if (drag.mode === "resize") {
      const cav = layout.cavities.find((c) => c.id === drag.id);
      if (!cav) return;

      const leftPx = blockOffset.x + cav.x * blockPx.width;
      const topPx = blockOffset.y + cav.y * blockPx.height;

      const widthPx = ptX - leftPx;
      const heightPx = ptY - topPx;

      // Convert to inches
      const newLengthIn = widthPx / scale;
      const newWidthIn = heightPx / scale;

      resizeAction(drag.id, newLengthIn, newWidthIn);
    }
  };

  const handleCanvasMouseUp = () => {
    setDrag(null);
  };

  const handleBackgroundClick = () => {
    setDrag(null);
    selectAction(null);
  };

  // 🔧 WIDENED THIS TYPE: SVGElement instead of SVGRectElement
  const handleBodyMouseDown = (
    e: MouseEvent<SVGElement>,
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
      id: cavity.id,
      mode: "move",
      offsetX: ptX - cavX,
      offsetY: ptY - cavY,
    });
    selectAction(cavity.id);
  };

  const handleHandleMouseDown = (
    e: MouseEvent<SVGRectElement>,
    cavity: Cavity
  ) => {
    e.stopPropagation();
    setDrag({
      id: cavity.id,
      mode: "resize",
      offsetX: 0,
      offsetY: 0,
    });
    selectAction(cavity.id);
  };

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
      <div className="mb-2 text-xs font-medium text-slate-600">
        Drag cavities to adjust placement. Use the square handle at the
        bottom-right of each cavity to resize. Block and cavities are scaled in
        inches; a 0.5&quot; wall is kept clear on all sides.
      </div>

      <div className="overflow-hidden rounded-xl bg-white">
        <svg
          ref={svgRef}
          width={canvasWidth}
          height={canvasHeight}
          className="block w-full max-w-full"
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={handleBackgroundClick}
        >
          {/* Grid inside the block footprint */}
          <defs>
            <pattern
              id="foam-grid-pattern"
              x="0"
              y="0"
              width={gridSpacingPx}
              height={gridSpacingPx}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridSpacingPx} 0 L 0 0 0 ${gridSpacingPx}`}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>

          {/* Block outline */}
          <rect
            x={blockOffset.x}
            y={blockOffset.y}
            width={blockPx.width}
            height={blockPx.height}
            rx={0}
            ry={0}
            fill="#f3f4ff"
            stroke="#c7d2fe"
            strokeWidth={2}
          />

          {/* Inner wall margin (0.5" keep-out) */}
          <rect
            x={innerBlock.x}
            y={innerBlock.y}
            width={innerBlock.width}
            height={innerBlock.height}
            rx={0}
            ry={0}
            fill="url(#foam-grid-pattern)"
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          {/* Block label */}
          <text
            x={blockOffset.x + blockPx.width / 2}
            y={blockOffset.y - 10}
            textAnchor="middle"
            fill="#4b5563"
            fontSize={11}
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          >
            Block: {block.lengthIn}×{block.widthIn}×{block.thicknessIn}"
            {" thick"}
          </text>

          {/* Cavities */}
          {layout.cavities.map((cavity) => {
            const cavWidthPx =
              (cavity.lengthIn / block.lengthIn) * blockPx.width;
            const cavHeightPx =
              (cavity.widthIn / block.widthIn) * blockPx.height;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const isSelected = cavity.id === selectedId;

            const handleSize = 10;
            const handleX = cavX + cavWidthPx - handleSize;
            const handleY = cavY + cavHeightPx - handleSize;

            const label =
              cavity.label ||
              `${cavity.lengthIn}×${cavity.widthIn}×${cavity.depthIn}"`;

            const commonStroke = isSelected ? "#1d4ed8" : "#4b5563";
            const commonFill = isSelected ? "#bfdbfe" : "#e5e7eb";

            const radiusPx = Math.min(
              (cavity.cornerRadiusIn || 0) * scale,
              cavWidthPx / 2,
              cavHeightPx / 2
            );

            return (
              <g key={cavity.id}>
                {cavity.shape === "circle" ? (
                  <>
                    {(() => {
                      const diameterPx = Math.min(cavWidthPx, cavHeightPx);
                      const cx = cavX + diameterPx / 2;
                      const cy = cavY + diameterPx / 2;
                      return (
                        <>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={diameterPx / 2}
                            fill={commonFill}
                            stroke={commonStroke}
                            strokeWidth={isSelected ? 2 : 1}
                            onMouseDown={(e) =>
                              handleBodyMouseDown(e, cavity)
                            }
                          />
                          <text
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#111827"
                            fontSize={10}
                            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                          >
                            {label}
                          </text>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <rect
                      x={cavX}
                      y={cavY}
                      width={cavWidthPx}
                      height={cavHeightPx}
                      rx={cavity.shape === "roundRect" ? radiusPx : 2}
                      ry={cavity.shape === "roundRect" ? radiusPx : 2}
                      fill={commonFill}
                      stroke={commonStroke}
                      strokeWidth={isSelected ? 2 : 1}
                      onMouseDown={(e) => handleBodyMouseDown(e, cavity)}
                    />
                    <text
                      x={cavX + cavWidthPx / 2}
                      y={cavY + cavHeightPx / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#111827"
                      fontSize={10}
                      fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                    >
                      {label}
                    </text>
                  </>
                )}

                {/* Resize handle — always visible */}
                <rect
                  x={handleX}
                  y={handleY}
                  width={handleSize}
                  height={handleSize}
                  rx={2}
                  ry={2}
                  fill={isSelected ? "#1d4ed8" : "#ffffff"}
                  stroke={isSelected ? "#1d4ed8" : "#4b5563"}
                  strokeWidth={1}
                  onMouseDown={(e) => handleHandleMouseDown(e, cavity)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Proportional top-view layout — block and cavities are scaled to each
        other based on inch dimensions. A 0.5&quot; wall is reserved around the
        block so cavities don&apos;t get too close to the edges. Resizing snaps
        length and width to 0.125&quot; increments.
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
  const padding = 60;
  const availableW = canvasWidth - padding * 2;
  const availableH = canvasHeight - padding * 2;

  const sx = availableW / lenIn;
  const sy = availableH / widthIn;
  return Math.min(sx, sy);
}
