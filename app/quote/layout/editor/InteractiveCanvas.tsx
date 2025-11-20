// app/quote/layout/editor/InteractiveCanvas.tsx
//
// SVG-based canvas that can render the block + cavities
// and supports:
//   - drag-to-move inside a 0.5" wall
//   - drag handle at bottom-right to resize
//   - 0.125" snap for length/width
//
// Props are kept very simple so page.tsx can just forward
// to useLayoutModel’s helpers.

"use client";

import { useRef, useState, MouseEvent } from "react";
import type { LayoutModel, Cavity } from "./layoutTypes";

type Props = {
  layout: LayoutModel;
  selectedId: string | null;
  selectAction: (id: string | null) => void;
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
  // IMPORTANT: id + length + width, nothing fancy.
  resizeAction: (id: string, lengthIn: number, widthIn: number) => void;
};

type DragState =
  | {
      mode: "move";
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      mode: "resize";
      id: string;
    }
  | null;

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 320;
const PADDING = 32;
const WALL_IN = 0.5; // inner wall (inches)
const SNAP_IN = 0.125; // snap grid (inches)

export default function InteractiveCanvas({
  layout,
  selectedId,
  selectAction,
  moveAction,
  resizeAction,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  const { block, cavities } = layout;

  // scale block L/W into canvas area
  const innerW = CANVAS_WIDTH - PADDING * 2;
  const innerH = CANVAS_HEIGHT - PADDING * 2;

  const sx = innerW / (block.lengthIn || 1);
  const sy = innerH / (block.widthIn || 1);
  const scale = Math.min(sx, sy);

  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  const blockOffset = {
    x: (CANVAS_WIDTH - blockPx.width) / 2,
    y: (CANVAS_HEIGHT - blockPx.height) / 2,
  };

  const handleCavityMouseDown = (
    e: MouseEvent<SVGGraphicsElement>,
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
      mode: "move",
      id: cavity.id,
      offsetX: ptX - cavX,
      offsetY: ptY - cavY,
    });

    selectAction(cavity.id);
  };

  const handleResizeMouseDown = (
    e: MouseEvent<SVGGraphicsElement>,
    cavity: Cavity
  ) => {
    e.stopPropagation();
    setDrag({
      mode: "resize",
      id: cavity.id,
    });
    selectAction(cavity.id);
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    const cav = cavities.find((c) => c.id === drag.id);
    if (!cav) return;

    if (drag.mode === "move") {
      // move the whole cavity, keeping size fixed
      const cavWidthPx = (cav.lengthIn / block.lengthIn) * blockPx.width;
      const cavHeightPx = (cav.widthIn / block.widthIn) * blockPx.height;

      const cavX = ptX - drag.offsetX;
      const cavY = ptY - drag.offsetY;

      let xNorm = (cavX - blockOffset.x) / blockPx.width;
      let yNorm = (cavY - blockOffset.y) / blockPx.height;

      // convert norms to inches to clamp against 0.5" wall
      const len = cav.lengthIn;
      const wid = cav.widthIn;

      const minXIn = WALL_IN;
      const maxXIn = block.lengthIn - WALL_IN - len;
      const minYIn = WALL_IN;
      const maxYIn = block.widthIn - WALL_IN - wid;

      const xIn = clamp(
        xNorm * block.lengthIn,
        Math.min(minXIn, maxXIn),
        Math.max(minXIn, maxXIn)
      );
      const yIn = clamp(
        yNorm * block.widthIn,
        Math.min(minYIn, maxYIn),
        Math.max(minYIn, maxYIn)
      );

      xNorm = xIn / block.lengthIn;
      yNorm = yIn / block.widthIn;

      moveAction(drag.id, xNorm, yNorm);
    } else if (drag.mode === "resize") {
      // resize from bottom-right, keeping top-left fixed
      const cavX = blockOffset.x + cav.x * blockPx.width;
      const cavY = blockOffset.y + cav.y * blockPx.height;

      const newWidthPx = ptX - cavX;
      const newHeightPx = ptY - cavY;

      let newLenIn = newWidthPx / scale;
      let newWidIn = newHeightPx / scale;

      // snap to 1/8"
      newLenIn = snapInches(newLenIn);
      newWidIn = snapInches(newWidIn);

      // enforce minimum size
      const minSize = SNAP_IN * 2;
      newLenIn = Math.max(minSize, newLenIn);
      newWidIn = Math.max(minSize, newWidIn);

      // enforce 0.5" wall on far edges
      const startXIn = cav.x * block.lengthIn;
      const startYIn = cav.y * block.widthIn;

      const maxLenIn = block.lengthIn - WALL_IN - startXIn;
      const maxWidIn = block.widthIn - WALL_IN - startYIn;

      newLenIn = clamp(newLenIn, minSize, Math.max(minSize, maxLenIn));
      newWidIn = clamp(newWidIn, minSize, Math.max(minSize, maxWidIn));

      resizeAction(drag.id, newLenIn, newWidIn);
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
        bottom-right of each cavity to resize. Block and cavities are scaled in
        inches; a 0.5" wall is kept clear on all sides.
      </div>

      <div className="overflow-hidden rounded-xl bg-white">
        <svg
          ref={svgRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full max-w-full"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleBackgroundClick}
        >
          {/* faint grid */}
          <defs>
            <pattern
              id="grid-8"
              x="0"
              y="0"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 8 0 L 0 0 0 8"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect
            x={0}
            y={0}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="url(#grid-8)"
          />

          {/* Block outline */}
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

          {/* Inner 0.5" wall (dashed) */}
          <rect
            x={blockOffset.x + (WALL_IN / block.lengthIn) * blockPx.width}
            y={blockOffset.y + (WALL_IN / block.widthIn) * blockPx.height}
            width={
              blockPx.width * (1 - (2 * WALL_IN) / (block.lengthIn || 1))
            }
            height={blockPx.height * (1 - (2 * WALL_IN) / (block.widthIn || 1))}
            fill="none"
            stroke="#94a3b8"
            strokeDasharray="4 3"
            strokeWidth={1}
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
          {cavities.map((cavity) => {
            const cavWidthPx =
              (cavity.lengthIn / block.lengthIn) * blockPx.width;
            const cavHeightPx =
              (cavity.widthIn / block.widthIn) * blockPx.height;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const isSelected = cavity.id === selectedId;

            // bottom-right resize handle in px
            const handleSize = 10;
            const handleX = cavX + cavWidthPx - handleSize / 2;
            const handleY = cavY + cavHeightPx - handleSize / 2;

            return (
              <g key={cavity.id}>
                {/* main cavity body */}
                <rect
                  x={cavX}
                  y={cavY}
                  width={cavWidthPx}
                  height={cavHeightPx}
                  rx={(cavity.cornerRadiusIn || 0) * scale}
                  ry={(cavity.cornerRadiusIn || 0) * scale}
                  fill={isSelected ? "#bfdbfe" : "#e5e7eb"}
                  stroke={isSelected ? "#1d4ed8" : "#9ca3af"}
                  strokeWidth={isSelected ? 2 : 1}
                  onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                />
                {/* label */}
                <text
                  x={cavX + cavWidthPx / 2}
                  y={cavY + cavHeightPx / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-700 text-[9px]"
                >
                  {cavity.lengthIn}×{cavity.widthIn}×{cavity.depthIn}"
                </text>
                {/* resize handle — always visible */}
                <rect
                  x={handleX}
                  y={handleY}
                  width={handleSize}
                  height={handleSize}
                  rx={2}
                  ry={2}
                  fill={isSelected ? "#1d4ed8" : "#64748b"}
                  stroke="#e5e7eb"
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

function snapInches(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
