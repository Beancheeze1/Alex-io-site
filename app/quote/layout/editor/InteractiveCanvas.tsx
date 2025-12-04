// app/quote/layout/editor/InteractiveCanvas.tsx
//
// SVG-based canvas that can render the block + cavities
// and supports:
//   - drag-to-move inside a 0.5" wall
//   - drag handle at bottom-right to resize
//   - 0.0625" snap for movement + size
//   - 0.5" grid inside the block
//   - dimensions from selected cavity to walls + nearest neighbor
//   - minimum ~0.5" gap between cavities
//   - zoom handled via scale prop
//   - pan: hold Spacebar for hand tool, drag to pan

"use client";

import { useRef, useState, useEffect, MouseEvent } from "react";

import { LayoutModel, Cavity, formatCavityLabel } from "./layoutTypes";

type Props = {
  layout: LayoutModel;
  selectedId: string | null;
  selectAction: (id: string | null) => void;
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
  resizeAction: (id: string, lengthIn: number, widthIn: number) => void;
  zoom: number;
  croppedCorners?: boolean; // currently visual-only (outer chamfer)
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

// Back to original internal canvas size so side panels still fit on screen
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 620;

// Reserved band at the top of the SVG for auto notes (QUOTE / NOT TO SCALE / BLOCK / MATERIAL)
// The foam block + cavities are always drawn below this Y, so notes never overlap the block.
const HEADER_BAND = 80;

const PADDING = 32;
const WALL_IN = 0.5;
// Snap for movement / resize = 1/16"
const SNAP_IN = 0.0625;
const MIN_GAP_IN = 0.5;

// Color palette used for cavity outlines / handles.
// These are intentionally bright enough to read on the slate background.
const CAVITY_COLORS = [
  "#38bdf8", // sky
  "#a855f7", // purple
  "#f97316", // orange
  "#22c55e", // green
  "#eab308", // yellow
  "#ec4899", // pink
];

export default function InteractiveCanvas({
  layout,
  selectedId,
  selectAction,
  moveAction,
  resizeAction,
  zoom,
  croppedCorners = false, // NEW (default off, still visual-only)
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  // Pan state + refs live INSIDE the component (no top-level hooks)
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const [panMode, setPanMode] = useState(false);
  const isSpacebarHeldRef = useRef(false);

  // Spacebar toggles pan mode (hand tool)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isSpacebarHeldRef.current) {
        isSpacebarHeldRef.current = true;
        setPanMode(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacebarHeldRef.current = false;
        setPanMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const { block, cavities } = layout;

  // ==== Block scaling / centering (with zoom) ====
  const innerW = CANVAS_WIDTH - PADDING * 2;

  // For vertical space, we reserve HEADER_BAND at the top for the legend,
  // and use the remaining space for the foam block.
  const innerH = CANVAS_HEIGHT - PADDING * 2 - HEADER_BAND;

  const sx = innerW / (block.lengthIn || 1);
  const sy = innerH / (block.widthIn || 1);
  const baseScale = Math.min(sx, sy);
  const scale = baseScale * (zoom || 1);

  const blockPx = {
    width: block.lengthIn * scale,
    height: block.widthIn * scale,
  };

  // Horizontally center the block within the canvas.
  // Vertically, center it within the region BELOW the header band so that
  // the block's top is always >= HEADER_BAND and never collides with the notes.
  const blockOffset = {
    x: (CANVAS_WIDTH - blockPx.width) / 2,
    y: HEADER_BAND + (CANVAS_HEIGHT - HEADER_BAND - blockPx.height) / 2,
  };

  // 1.0" chamfer at upper-left and lower-right corners (45°)
  const CHAMFER_IN = 1;

  const canChamfer =
    block.lengthIn > CHAMFER_IN * 2 && block.widthIn > CHAMFER_IN * 2;

  // Pixel distance for a 1" run along X and Y (respects physical inches)
  const chamferPxX = (CHAMFER_IN / (block.lengthIn || 1)) * blockPx.width;
  const chamferPxY = (CHAMFER_IN / (block.widthIn || 1)) * blockPx.height;

  const x0 = blockOffset.x;
  const y0 = blockOffset.y;
  const w = blockPx.width;
  const h = blockPx.height;

  // Outer block path (UL & LR corners chamfered)
  const outerBlockPathD = canChamfer
    ? [
        `M ${x0 + chamferPxX},${y0}`, // top edge after UL chamfer
        `L ${x0 + w},${y0}`, // top-right
        `L ${x0 + w},${y0 + h - chamferPxY}`, // right edge before LR chamfer
        `L ${x0 + w - chamferPxX},${y0 + h}`, // LR chamfer
        `L ${x0},${y0 + h}`, // bottom-left
        `L ${x0},${y0 + chamferPxY}`, // left edge before UL chamfer
        "Z",
      ].join(" ")
    : [
        `M ${x0},${y0}`,
        `L ${x0 + w},${y0}`,
        `L ${x0 + w},${y0 + h}`,
        `L ${x0},${y0 + h}`,
        "Z",
      ].join(" ");

  // Inner 0.5" safety wall (also chamfered, but still used as a rectangular
  // spacing reference for movement / gap checks)
  const L = block.lengthIn || 1;
  const W = block.widthIn || 1;

  const usableLenIn = Math.max(L - 2 * WALL_IN, 0);
  const usableWidIn = Math.max(W - 2 * WALL_IN, 0);

  const innerX0 = x0 + (WALL_IN / L) * w;
  const innerY0 = y0 + (WALL_IN / W) * h;
  const innerWallWidthPx = w * (usableLenIn / L);
  const innerWallHeightPx = h * (usableWidIn / W);

  const canInnerChamfer =
    canChamfer && usableLenIn > CHAMFER_IN * 2 && usableWidIn > CHAMFER_IN * 2;

  const innerWallPathD = canInnerChamfer
    ? [
        `M ${innerX0 + chamferPxX},${innerY0}`, // top edge after UL chamfer
        `L ${innerX0 + innerWallWidthPx},${innerY0}`, // top-right
        `L ${
          innerX0 + innerWallWidthPx
        },${innerY0 + innerWallHeightPx - chamferPxY}`, // right edge before LR chamfer
        `L ${
          innerX0 + innerWallWidthPx - chamferPxX
        },${innerY0 + innerWallHeightPx}`, // LR chamfer
        `L ${innerX0},${innerY0 + innerWallHeightPx}`, // bottom-left
        `L ${innerX0},${innerY0 + chamferPxY}`, // left edge before UL chamfer
        "Z",
      ].join(" ")
    : [
        `M ${innerX0},${innerY0}`,
        `L ${innerX0 + innerWallWidthPx},${innerY0}`,
        `L ${innerX0 + innerWallWidthPx},${innerY0 + innerWallHeightPx}`,
        `L ${innerX0},${innerY0 + innerWallHeightPx}`,
        "Z",
      ].join(" ");

  const selectedCavity =
    cavities.find((c) => c.id === selectedId) || null;
  // Pan pointer handlers (scroll the parent while space is held)
  const handlePointerDownPan = (e: any) => {
    if (!panMode) return;
    const target = canvasWrapperRef.current;
    if (!target) return;

    target.setPointerCapture(e.pointerId);
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMovePan = (e: any) => {
    if (!panMode) return;
    const wrap = canvasWrapperRef.current;
    if (!wrap || !lastPanRef.current) return;
    const parent = wrap.parentElement;
    if (!parent) return;

    const dx = e.clientX - lastPanRef.current.x;
    const dy = e.clientY - lastPanRef.current.y;

    parent.scrollLeft -= dx;
    parent.scrollTop -= dy;

    lastPanRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUpPan = (e: any) => {
    if (!panMode) return;
    lastPanRef.current = null;
    try {
      canvasWrapperRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture isn't set
    }
  };

  // ==== Mouse handlers for cavities ====

  const handleCavityMouseDown = (
    e: MouseEvent<SVGGraphicsElement>,
    cavity: Cavity,
  ) => {
    // If we’re in pan mode, don’t start a drag on the cavity
    if (panMode) return;

    e.stopPropagation();
    e.preventDefault();
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
    cavity: Cavity,
  ) => {
    if (panMode) return;

    e.stopPropagation();
    e.preventDefault();
    setDrag({
      mode: "resize",
      id: cavity.id,
    });
    selectAction(cavity.id);
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    // Don’t move / resize cavities while panning
    if (panMode || !drag || !svgRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const ptX = e.clientX - svgRect.left;
    const ptY = e.clientY - svgRect.top;

    const cav = cavities.find((c) => c.id === drag.id);
    if (!cav) return;

    if (drag.mode === "move") {
      // move whole cavity, keep size fixed
      const cavWidthPx = (cav.lengthIn / block.lengthIn) * blockPx.width;
      const cavHeightPx = (cav.widthIn / block.widthIn) * blockPx.height;

      const cavX = ptX - drag.offsetX;
      const cavY = ptY - drag.offsetY;

      let xNorm = (cavX - blockOffset.x) / blockPx.width;
      let yNorm = (cavY - blockOffset.y) / blockPx.height;

      const len = cav.lengthIn;
      const wid = cav.widthIn;

      const minXIn = WALL_IN;
      const maxXIn = block.lengthIn - WALL_IN - len;
      const minYIn = WALL_IN;
      const maxYIn = block.widthIn - WALL_IN - wid;

      let xIn = snapInches(xNorm * block.lengthIn);
      let yIn = snapInches(yNorm * block.widthIn);

      xIn = clamp(xIn, Math.min(minXIn, maxXIn), Math.max(minXIn, maxXIn));
      yIn = clamp(yIn, Math.min(minYIn, maxYIn), Math.max(minYIn, maxYIn));

      // enforce 0.5" min gap to other cavities
      if (
        violatesMinGap(
          cav.id,
          xIn,
          yIn,
          len,
          wid,
          block,
          cavities,
          MIN_GAP_IN,
        )
      ) {
        return;
      }

      xNorm = xIn / block.lengthIn;
      yNorm = yIn / block.widthIn;

      moveAction(drag.id, xNorm, yNorm);
    } else if (drag.mode === "resize") {
      // resize from bottom-right, top-left fixed
      const startXIn = cav.x * block.lengthIn;
      const startYIn = cav.y * block.widthIn;

      const cavX = blockOffset.x + cav.x * blockPx.width;
      const cavY = blockOffset.y + cav.y * blockPx.height;

      const newWidthPx = ptX - cavX;
      const newHeightPx = ptY - cavY;

      let newLenIn = newWidthPx / scale;
      let newWidIn = newHeightPx / scale;

      newLenIn = snapInches(newLenIn);
      newWidIn = snapInches(newWidIn);

      const minSize = SNAP_IN * 2;
      newLenIn = Math.max(minSize, newLenIn);
      newWidIn = Math.max(minSize, newWidIn);

      // circle = keep diameter equal
      if (cav.shape === "circle") {
        const d = Math.max(newLenIn, newWidIn);
        newLenIn = d;
        newWidIn = d;
      }

      const maxLenIn = block.lengthIn - WALL_IN - startXIn;
      const maxWidIn = block.widthIn - WALL_IN - startYIn;

      newLenIn = clamp(newLenIn, minSize, Math.max(minSize, maxLenIn));
      newWidIn = clamp(newWidIn, minSize, Math.max(minSize, maxWidIn));

      if (
        violatesMinGap(
          cav.id,
          startXIn,
          startYIn,
          newLenIn,
          newWidIn,
          block,
          cavities,
          MIN_GAP_IN,
        )
      ) {
        return;
      }

      resizeAction(drag.id, newLenIn, newWidIn);
    }
  };

  const handleMouseUp = () => {
    setDrag(null);
  };

  const innerWall = {
    leftIn: WALL_IN,
    rightIn: block.lengthIn - WALL_IN,
    topIn: WALL_IN,
    bottomIn: block.widthIn - WALL_IN,
  };

  const spacing = selectedCavity
    ? computeSpacing(selectedCavity, block, cavities, blockPx, blockOffset)
    : null;
  return (
    // outer wrapper stays neutral – the dark grid comes from the parent
    <div
      ref={canvasWrapperRef}
      className={`rounded-2xl ${panMode ? "cursor-grabbing" : ""}`}
      onPointerDown={handlePointerDownPan}
      onPointerMove={handlePointerMovePan}
      onPointerUp={handlePointerUpPan}
    >
      <div className="overflow-auto rounded-xl">
        <svg
          ref={svgRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          // Keep CSS width tied to the internal canvas size so drag math stays correct
          className="block"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* background – transparent so the page-level dark grid shows through */}
          <rect
            x={0}
            y={0}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="transparent"
          />

          {/* rulers + block label ABOVE the top ruler */}
          {drawRulersWithLabel(block, blockPx, blockOffset)}

          {/* block with 1" 45° chamfers at upper-left and lower-right */}
          <path
            d={outerBlockPathD}
            fill="#e5e7eb" // light foam block
            stroke="#cbd5f5"
            strokeWidth={2}
          />

          {/* 0.5" grid *inside* the block */}
          {drawInchGrid(block, blockPx, blockOffset)}

          {/* 0.5" inner wall (dashed, matches chamfer shape where possible) */}
          <path
            d={innerWallPathD}
            fill="none"
            stroke="#94a3b8"
            strokeDasharray="4 3"
            strokeWidth={1}
          />

          {/* cavities */}
          {cavities.map((cavity, index) => {
            const cavWidthPx =
              (cavity.lengthIn / block.lengthIn) * blockPx.width;
            const cavHeightPx =
              (cavity.widthIn / block.widthIn) * blockPx.height;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const isSelected = cavity.id === selectedId;
            const isCircle = cavity.shape === "circle";
            const isRounded = cavity.shape === "roundedRect";

            const cornerRadiusPx = isRounded
              ? Math.min(
                  cavity.cornerRadiusIn * scale,
                  cavWidthPx / 2,
                  cavHeightPx / 2,
                )
              : 0;

            const handleSize = 10;
            const handleX = cavX + cavWidthPx - handleSize / 2;
            const handleY = cavY + cavHeightPx - handleSize / 2;

            // color-coding: each cavity gets a color from the palette
            const color = CAVITY_COLORS[index % CAVITY_COLORS.length];
            const strokeColor = isSelected ? color : `${color}cc`;
            const handleColor = color;
            const cavityFill = "#d4d4d8"; // slightly darker than block
            return (
              <g key={cavity.id}>
                {isCircle ? (
                  <circle
                    cx={cavX + cavWidthPx / 2}
                    cy={cavY + cavHeightPx / 2}
                    r={Math.min(cavWidthPx, cavHeightPx) / 2}
                    fill={cavityFill}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2 : 1}
                    onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                  />
                ) : (
                  <rect
                    x={cavX}
                    y={cavY}
                    width={cavWidthPx}
                    height={cavHeightPx}
                    rx={cornerRadiusPx}
                    ry={cornerRadiusPx}
                    fill={cavityFill}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2 : 1}
                    onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                  />
                )}

                {/* label (computed from dims so it always matches the cavity size) */}
                <text
                  x={cavX + cavWidthPx / 2}
                  y={cavY + cavHeightPx / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-800 text-[9px]"
                  onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                >
                  {formatCavityLabel(cavity)}
                </text>

                {/* resize handle */}
                <rect
                  x={handleX}
                  y={handleY}
                  width={handleSize}
                  height={handleSize}
                  rx={2}
                  ry={2}
                  fill={handleColor}
                  stroke="#020617"
                  strokeWidth={1}
                  onMouseDown={(e) => handleResizeMouseDown(e, cavity)}
                />
              </g>
            );
          })}

          {/* spacing dims for selected cavity */}
          {spacing && drawSpacing(spacing)}
        </svg>
      </div>
    </div>
  );
}

// ===== helpers =====

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
// simple “keep at least MIN_GAP_IN between cavities” check
function violatesMinGap(
  id: string,
  xIn: number,
  yIn: number,
  lenIn: number,
  widIn: number,
  block: LayoutModel["block"],
  cavities: Cavity[],
  minGapIn: number,
): boolean {
  const x1 = xIn;
  const x2 = xIn + lenIn;
  const y1 = yIn;
  const y2 = yIn + widIn;

  for (const cav of cavities) {
    if (cav.id === id) continue;

    const ox1 = cav.x * block.lengthIn;
    const ox2 = ox1 + cav.lengthIn;
    const oy1 = cav.y * block.widthIn;
    const oy2 = oy1 + cav.widthIn;

    const gapX = Math.max(0, Math.max(ox1 - x2, x1 - ox2));
    const gapY = Math.max(0, Math.max(oy1 - y2, y1 - oy2));

    if (gapX < minGapIn && gapY < minGapIn) {
      return true;
    }
  }

  return false;
}

// 0.5" grid inside block
function drawInchGrid(
  block: LayoutModel["block"],
  blockPx: { width: number; height: number },
  blockOffset: { x: number; y: number },
) {
  const vLines = [];
  for (let xIn = 0.5; xIn < block.lengthIn; xIn += 0.5) {
    const x = blockOffset.x + (xIn / block.lengthIn) * blockPx.width;
    vLines.push(
      <line
        key={`v-${xIn.toFixed(1)}`}
        x1={x}
        y1={blockOffset.y}
        x2={x}
        y2={blockOffset.y + blockPx.height}
        stroke="#d4d4d8"
        strokeWidth={0.5}
      />,
    );
  }

  const hLines = [];
  for (let yIn = 0.5; yIn < block.widthIn; yIn += 0.5) {
    const y = blockOffset.y + (yIn / block.widthIn) * blockPx.height;
    hLines.push(
      <line
        key={`h-${yIn.toFixed(1)}`}
        x1={blockOffset.x}
        y1={y}
        x2={blockOffset.x + blockPx.width}
        y2={y}
        stroke="#d4d4d8"
        strokeWidth={0.5}
      />,
    );
  }

  return (
    <g>
      {vLines}
      {hLines}
    </g>
  );
}

// Top + left rulers and block label above ruler
function drawRulersWithLabel(
  block: LayoutModel["block"],
  blockPx: { width: number; height: number },
  blockOffset: { x: number; y: number },
) {
  const group = [];

  // Positions
  const rulerTopY = blockOffset.y - 18; // baseline of top ruler ticks
  const labelY = rulerTopY - 12; // block text above ruler
  const leftRulerX = blockOffset.x - 22; // vertical ruler just left of block

  // Block label (centered, above ruler)
  group.push(
    <text
      key="block-label"
      x={blockOffset.x + blockPx.width / 2}
      y={labelY}
      textAnchor="middle"
      className="fill-slate-300 text-[10px]"
    >
      Block {block.lengthIn}" × {block.widthIn}" × {block.thicknessIn}" thick
    </text>,
  );
  // Horizontal ruler (top)
  const maxL = Math.max(0, Math.floor(block.lengthIn || 0));
  if (block.lengthIn > 0) {
    for (let i = 0; i <= maxL; i++) {
      const x = blockOffset.x + (i / block.lengthIn) * blockPx.width;
      const isMajor = i % 1 === 0;
      const tickHeight = isMajor ? 8 : 4;

      group.push(
        <line
          key={`hrule-${i}`}
          x1={x}
          y1={rulerTopY}
          x2={x}
          y2={rulerTopY + tickHeight}
          stroke="#9ca3af"
          strokeWidth={1}
        />,
      );

      if (isMajor) {
        group.push(
          <text
            key={`hrule-label-${i}`}
            x={x}
            y={rulerTopY - 4}
            textAnchor="middle"
            className="fill-slate-400 text-[9px]"
          >
            {i}
          </text>,
        );
      }
    }
  }

  // Horizontal baseline
  group.push(
    <line
      key="hrule-base"
      x1={blockOffset.x}
      y1={rulerTopY}
      x2={blockOffset.x + blockPx.width}
      y2={rulerTopY}
      stroke="#6b7280"
      strokeWidth={1}
    />,
  );

  // Vertical ruler (left)
  const maxW = Math.max(0, Math.floor(block.widthIn || 0));
  if (block.widthIn > 0) {
    for (let i = 0; i <= maxW; i++) {
      const y = blockOffset.y + (i / block.widthIn) * blockPx.height;
      const isMajor = i % 1 === 0;
      const tickWidth = isMajor ? 8 : 4;

      group.push(
        <line
          key={`vrule-${i}`}
          x1={leftRulerX}
          y1={y}
          x2={leftRulerX + tickWidth}
          y2={y}
          stroke="#9ca3af"
          strokeWidth={1}
        />,
      );

      if (isMajor) {
        group.push(
          <text
            key={`vrule-label-${i}`}
            x={leftRulerX - 4}
            y={y + 3}
            textAnchor="end"
            className="fill-slate-400 text-[9px]"
          >
            {i}
          </text>,
        );
      }
    }
  }

  // Vertical baseline
  group.push(
    <line
      key="vrule-base"
      x1={leftRulerX + 0.5}
      y1={blockOffset.y}
      x2={leftRulerX + 0.5}
      y2={blockOffset.y + blockPx.height}
      stroke="#6b7280"
      strokeWidth={1}
    />,
  );

  return <g>{group}</g>;
}

// ===== spacing calcs (edges + nearest neighbor) =====

type SpacingInfo = {
  edgeDims: {
    leftPx: number;
    rightPx: number;
    topPx: number;
    bottomPx: number;
    cavLeftPx: number;
    cavRightPx: number;
    cavTopPx: number;
    cavBottomPx: number;
    leftIn: number;
    rightIn: number;
    topIn: number;
    bottomIn: number;
  };
  neighborDims: {
    horiz?: {
      fromPx: number;
      toPx: number;
      yPx: number;
      gapIn: number;
    };
    vert?: {
      fromPx: number;
      toPx: number;
      xPx: number;
      gapIn: number;
    };
  };
};

/**
 * Compute spacing from the selected cavity to:
 *  - the foam block edges (with dotted lines + dimensions)
 *  - the nearest neighbor cavity horizontally + vertically
 */
function computeSpacing(
  cav: Cavity,
  block: LayoutModel["block"],
  cavities: Cavity[],
  blockPx: { width: number; height: number },
  blockOffset: { x: number; y: number },
): SpacingInfo {
  // Cavity edges in inches
  const cavLeftIn = cav.x * block.lengthIn;
  const cavTopIn = cav.y * block.widthIn;
  const cavRightIn = cavLeftIn + cav.lengthIn;
  const cavBottomIn = cavTopIn + cav.widthIn;

  // Distances from cavity to OUTER foam edges (what you want to see)
  const leftIn = cavLeftIn;
  const rightIn = block.lengthIn - cavRightIn;
  const topIn = cavTopIn;
  const bottomIn = block.widthIn - cavBottomIn;

  // Cavity edges in pixels
  const cavLeftPx =
    blockOffset.x + (cavLeftIn / block.lengthIn) * blockPx.width;
  const cavRightPx =
    blockOffset.x + (cavRightIn / block.lengthIn) * blockPx.width;
  const cavTopPx =
    blockOffset.y + (cavTopIn / block.widthIn) * blockPx.height;
  const cavBottomPx =
    blockOffset.y + (cavBottomIn / block.widthIn) * blockPx.height;

  // Foam block outer edges in pixels
  const leftWallPx = blockOffset.x;
  const rightWallPx = blockOffset.x + blockPx.width;
  const topWallPx = blockOffset.y;
  const bottomWallPx = blockOffset.y + blockPx.height;

  // Nearest neighbor cavity gaps
  let bestHorizGapIn = Infinity;
  let bestHoriz: SpacingInfo["neighborDims"]["horiz"] | undefined;
  let bestVertGapIn = Infinity;
  let bestVert: SpacingInfo["neighborDims"]["vert"] | undefined;

  for (const other of cavities) {
    if (other.id === cav.id) continue;

    const oLeftIn = other.x * block.lengthIn;
    const oTopIn = other.y * block.widthIn;
    const oRightIn = oLeftIn + other.lengthIn;
    const oBottomIn = oTopIn + other.widthIn;

    const oLeftPx =
      blockOffset.x + (oLeftIn / block.lengthIn) * blockPx.width;
    const oRightPx =
      blockOffset.x + (oRightIn / block.lengthIn) * blockPx.width;
    const oTopPx =
      blockOffset.y + (oTopIn / block.widthIn) * blockPx.height;
    const oBottomPx =
      blockOffset.y + (oBottomIn / block.widthIn) * blockPx.height;

    // horizontal gaps (left/right) – need vertical overlap
    const vertOverlap = !(oBottomIn <= cavTopIn || oTopIn >= cavBottomIn);
    if (vertOverlap) {
      let gapIn: number | null = null;
      let fromPx = 0;
      let toPx = 0;

      if (oLeftIn >= cavRightIn) {
        gapIn = oLeftIn - cavRightIn;
        fromPx = cavRightPx;
        toPx = oLeftPx;
      } else if (cavLeftIn >= oRightIn) {
        gapIn = cavLeftIn - oRightIn;
        fromPx = oRightPx;
        toPx = cavLeftPx;
      }

      if (gapIn != null && gapIn < bestHorizGapIn && gapIn > 0) {
        bestHorizGapIn = gapIn;
        bestHoriz = {
          fromPx,
          toPx,
          yPx:
            (Math.max(cavTopPx, oTopPx) +
              Math.min(cavBottomPx, oBottomPx)) /
            2,
          gapIn,
        };
      }
    }

    // vertical gaps (above/below) – need horizontal overlap
    const horizOverlap = !(oRightIn <= cavLeftIn || oLeftIn >= cavRightIn);
    if (horizOverlap) {
      let gapIn: number | null = null;
      let fromPx = 0;
      let toPx = 0;

      if (oTopIn >= cavBottomIn) {
        gapIn = oTopIn - cavBottomIn;
        fromPx = cavBottomPx;
        toPx = oTopPx;
      } else if (cavTopIn >= oBottomIn) {
        gapIn = cavTopIn - oBottomIn;
        fromPx = oBottomPx;
        toPx = cavTopPx;
      }

      if (gapIn != null && gapIn < bestVertGapIn && gapIn > 0) {
        bestVertGapIn = gapIn;
        bestVert = {
          fromPx,
          toPx,
          xPx:
            (Math.max(cavLeftPx, oLeftPx) +
              Math.min(cavRightPx, oRightPx)) /
            2,
          gapIn,
        };
      }
    }
  }

  return {
    edgeDims: {
      leftPx: leftWallPx,
      rightPx: rightWallPx,
      topPx: topWallPx,
      bottomPx: bottomWallPx,
      cavLeftPx,
      cavRightPx,
      cavTopPx,
      cavBottomPx,
      leftIn,
      rightIn,
      topIn,
      bottomIn,
    },
    neighborDims: {
      horiz: bestHorizGapIn < Infinity ? bestHoriz : undefined,
      vert: bestVertGapIn < Infinity ? bestVert : undefined,
    },
  };
}

function drawSpacing(info: SpacingInfo) {
  const { edgeDims, neighborDims } = info;
  const textOffset = 8;

  return (
    <g>
      {/* left edge of foam block */}
      {edgeDims.leftIn > 0 && (
        <g>
          <line
            x1={edgeDims.leftPx}
            y1={edgeDims.cavTopPx}
            x2={edgeDims.leftPx}
            y2={edgeDims.cavBottomPx}
            stroke="#64748b"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text
            x={edgeDims.leftPx}
            y={edgeDims.cavTopPx - textOffset}
            textAnchor="middle"
            className="fill-slate-600 text-[9px]"
          >
            {edgeDims.leftIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* right edge of foam block */}
      {edgeDims.rightIn > 0 && (
        <g>
          <line
            x1={edgeDims.rightPx}
            y1={edgeDims.cavTopPx}
            x2={edgeDims.rightPx}
            y2={edgeDims.cavBottomPx}
            stroke="#64748b"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text
            x={edgeDims.rightPx}
            y={edgeDims.cavTopPx - textOffset}
            textAnchor="middle"
            className="fill-slate-600 text-[9px]"
          >
            {edgeDims.rightIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* top edge of foam block */}
      {edgeDims.topIn > 0 && (
        <g>
          <line
            x1={edgeDims.cavLeftPx}
            y1={edgeDims.topPx}
            x2={edgeDims.cavRightPx}
            y2={edgeDims.topPx}
            stroke="#64748b"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text
            x={(edgeDims.cavLeftPx + edgeDims.cavRightPx) / 2}
            y={edgeDims.topPx - textOffset}
            textAnchor="middle"
            className="fill-slate-600 text-[9px]"
          >
            {edgeDims.topIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* bottom edge of foam block */}
      {edgeDims.bottomIn > 0 && (
        <g>
          <line
            x1={edgeDims.cavLeftPx}
            y1={edgeDims.bottomPx}
            x2={edgeDims.cavRightPx}
            y2={edgeDims.bottomPx}
            stroke="#64748b"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text
            x={(edgeDims.cavLeftPx + edgeDims.cavRightPx) / 2}
            y={edgeDims.bottomPx + textOffset + 2}
            textAnchor="middle"
            className="fill-slate-600 text-[9px]"
          >
            {edgeDims.bottomIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* nearest horizontal neighbor (dotted line between cavities) */}
      {neighborDims.horiz && (
        <g>
          <line
            x1={neighborDims.horiz.fromPx}
            y1={neighborDims.horiz.yPx}
            x2={neighborDims.horiz.toPx}
            y2={neighborDims.horiz.yPx}
            stroke="#0f766e"
            strokeDasharray="3 2"
            strokeWidth={1}
          />
          <text
            x={(neighborDims.horiz.fromPx + neighborDims.horiz.toPx) / 2}
            y={neighborDims.horiz.yPx - 6}
            textAnchor="middle"
            className="fill-emerald-700 text-[9px]"
          >
            {neighborDims.horiz.gapIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* nearest vertical neighbor (dotted line between cavities) */}
      {neighborDims.vert && (
        <g>
          <line
            x1={neighborDims.vert.xPx}
            y1={neighborDims.vert.fromPx}
            x2={neighborDims.vert.xPx}
            y2={neighborDims.vert.toPx}
            stroke="#0f766e"
            strokeDasharray="3 2"
            strokeWidth={1}
          />
          <text
            x={neighborDims.vert.xPx + 4}
            y={(neighborDims.vert.fromPx + neighborDims.vert.toPx) / 2}
            className="fill-emerald-700 text-[9px]"
          >
            {neighborDims.vert.gapIn.toFixed(3)}"
          </text>
        </g>
      )}
    </g>
  );
}
