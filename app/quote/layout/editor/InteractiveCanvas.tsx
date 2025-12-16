// app/quote/layout/editor/InteractiveCanvas.tsx
//
// SVG-based canvas that can render the block + cavities
// SAFE: supports stack-based layouts without Apply-to-Quote

"use client";

import { useRef, useState, MouseEvent } from "react";
import { LayoutModel, Cavity, formatCavityLabel } from "./layoutTypes";

type Props = {
  layout: LayoutModel & { stack?: any[] };
  selectedId: string | null;
  selectAction: (id: string | null) => void;
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
  resizeAction: (id: string, lengthIn: number, widthIn: number) => void;
  zoom: number;
  croppedCorners?: boolean;
};

type DragState =
  | { mode: "move"; id: string; offsetX: number; offsetY: number }
  | { mode: "resize"; id: string }
  | null;

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 620;
const HEADER_BAND = 80;
const PADDING = 32;
const WALL_IN = 0.5;
const SNAP_IN = 0.0625;
const MIN_GAP_IN = 0.5;

const CAVITY_COLORS = [
  "#38bdf8",
  "#a855f7",
  "#f97316",
  "#22c55e",
  "#eab308",
  "#ec4899",
];

export default function InteractiveCanvas({
  layout,
  selectedId,
  selectAction,
  moveAction,
  resizeAction,
  zoom,
  croppedCorners = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  /** 🔒 PATH-A FIX:
   * layout.cavities may be empty when coming from email / URL.
   * If stack exists, always render cavities from the active (first) layer.
   */
  const cavities: Cavity[] =
    layout.cavities?.length
      ? layout.cavities
      : Array.isArray(layout.stack) && layout.stack[0]?.cavities
      ? layout.stack[0].cavities
      : [];

  const block = layout.block ?? { lengthIn: 10, widthIn: 10, thicknessIn: 1 };

  const innerW = CANVAS_WIDTH - PADDING * 2;
  const innerH = CANVAS_HEIGHT - PADDING * 2 - HEADER_BAND;

  const sx = innerW / (block.lengthIn || 1);
  const sy = innerH / (block.widthIn || 1);
  const baseScale = Math.min(sx, sy);
  const scale = baseScale * (zoom || 1);

  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  const blockOffset = {
    x: (CANVAS_WIDTH - blockPx.width) / 2,
    y: HEADER_BAND + (CANVAS_HEIGHT - HEADER_BAND - blockPx.height) / 2,
  };

  const selectedCavity =
    cavities.find((c) => c.id === selectedId) || null;

  const handleCavityMouseDown = (
    e: MouseEvent<SVGGraphicsElement>,
    cavity: Cavity,
  ) => {
    e.preventDefault();
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - rect.left;
    const ptY = e.clientY - rect.top;

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
    cavity: Cavity,
  ) => {
    e.preventDefault();
    setDrag({ mode: "resize", id: cavity.id });
    selectAction(cavity.id);
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - rect.left;
    const ptY = e.clientY - rect.top;

    const cav = cavities.find((c) => c.id === drag.id);
    if (!cav) return;

    if (drag.mode === "move") {
      const cavX = ptX - drag.offsetX;
      const cavY = ptY - drag.offsetY;

      let xNorm = (cavX - blockOffset.x) / blockPx.width;
      let yNorm = (cavY - blockOffset.y) / blockPx.height;

      const xIn = clamp(
        snap(xNorm * block.lengthIn),
        WALL_IN,
        block.lengthIn - WALL_IN - cav.lengthIn,
      );
      const yIn = clamp(
        snap(yNorm * block.widthIn),
        WALL_IN,
        block.widthIn - WALL_IN - cav.widthIn,
      );

      moveAction(cav.id, xIn / block.lengthIn, yIn / block.widthIn);
    }
  };

  const handleMouseUp = () => setDrag(null);

  return (
    <svg
      ref={svgRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className="block"
    >
      <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="transparent" />

      <rect
        x={blockOffset.x}
        y={blockOffset.y}
        width={blockPx.width}
        height={blockPx.height}
        fill="#e5e7eb"
        stroke="#94a3b8"
        strokeWidth={2}
      />

      {cavities.map((c, i) => {
        const w = (c.lengthIn / block.lengthIn) * blockPx.width;
        const h = (c.widthIn / block.widthIn) * blockPx.height;
        const x = blockOffset.x + c.x * blockPx.width;
        const y = blockOffset.y + c.y * blockPx.height;

        const color = CAVITY_COLORS[i % CAVITY_COLORS.length];
        const selected = c.id === selectedId;

        return (
          <g key={c.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="#d4d4d8"
              stroke={color}
              strokeWidth={selected ? 2 : 1}
              onMouseDown={(e) => handleCavityMouseDown(e, c)}
            />
            <text
              x={x + w / 2}
              y={y + h / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-800 text-[9px]"
            >
              {formatCavityLabel(c)}
            </text>
            <rect
              x={x + w - 6}
              y={y + h - 6}
              width={10}
              height={10}
              fill={color}
              onMouseDown={(e) => handleResizeMouseDown(e, c)}
            />
          </g>
        );
      })}
    </svg>
  );
}

function snap(v: number) {
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
