// app/quote/layout/editor/InteractiveCanvas.tsx
//
// SVG-based canvas that can render the block + cavities
// and supports simple click-to-select and drag-to-move.
//
// This does NOT hook into any page yet — next step is to
// import it into app/quote/layout/page.tsx and feed it a LayoutModel.

"use client";

import { useRef, useState, MouseEvent } from "react";
import type { LayoutModel, Cavity } from "./layoutTypes";

type Props = {
  layout: LayoutModel;
  selectedId: string | null;
  // renamed to avoid Next.js "on*" Server Action warning
  selectAction: (id: string | null) => void;
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
};

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
} | null;

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

  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  const blockOffset = {
    x: (canvasWidth - blockPx.width) / 2,
    y: (canvasHeight - blockPx.height) / 2,
  };

  const handleMouseDown = (e: MouseEvent<SVGRectElement>, cavity: Cavity) => {
    e.stopPropagation();
    if (!svgRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    const cavX = blockOffset.x + cavity.x * blockPx.width;
    const cavY = blockOffset.y + cavity.y * blockPx.height;

    setDrag({
      id: cavity.id,
      offsetX: ptX - cavX,
      offsetY: ptY - cavY,
    });
    selectAction(cavity.id);
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    const cavX = ptX - drag.offsetX;
    const cavY = ptY - drag.offsetY;

    const xNorm = (cavX - blockOffset.x) / blockPx.width;
    const yNorm = (cavY - blockOffset.y) / blockPx.height;

    moveAction(drag.id, xNorm, yNorm);
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
        Drag the cavities to adjust the layout. This is not to scale in absolute
        inches, but each cavity is proportional to the block.
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
            const cavWidth =
              (cavity.lengthIn / block.lengthIn) * blockPx.width;
            const cavHeight =
              (cavity.widthIn / block.widthIn) * blockPx.height;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const isSelected = cavity.id === selectedId;

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
                  onMouseDown={(e) => handleMouseDown(e, cavity)}
                />
                <text
                  x={cavX + cavWidth / 2}
                  y={cavY + cavHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-700 text-[9px]"
                >
                  {cavity.lengthIn}×{cavity.widthIn}×{cavity.depthIn}"
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Not to scale — this is a proportional top-view layout to help visualize
        block and cavity placement.
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
