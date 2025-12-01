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
//   - dark CAD-style workspace with rulers + snap highlighting

"use client";

import { useRef, useState, MouseEvent } from "react";
import { LayoutModel, Cavity, formatCavityLabel } from "./layoutTypes";

type Props = {
  layout: LayoutModel;
  selectedId: string | null;
  selectAction: (id: string | null) => void;
  moveAction: (id: string, xNorm: number, yNorm: number) => void;
  resizeAction: (id: string, lengthIn: number, widthIn: number) => void;
  zoom: number;
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

export default function InteractiveCanvas({
  layout,
  selectedId,
  selectAction,
  moveAction,
  resizeAction,
  zoom,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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

  const selectedCavity = cavities.find((c) => c.id === selectedId) || null;

  // ==== Mouse handlers ====

  const handleCavityMouseDown = (
    e: MouseEvent<SVGGraphicsElement>,
    cavity: Cavity,
  ) => {
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
    e.stopPropagation();
    e.preventDefault();
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
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.9)]">
      {/* Allow scrolling when zooming in so the whole block is always accessible */}
      <div className="overflow-auto rounded-xl bg-slate-950">
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
          {/* workspace background */}
          <rect
            x={0}
            y={0}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="#020617"
          />

          {/* subtle global grid to match outer workspace */}
          <g opacity={0.4}>
            {/* vertical */}
            {Array.from({ length: Math.floor(CANVAS_WIDTH / 28) + 1 }).map(
              (_, idx) => {
                const x = idx * 28;
                return (
                  <line
                    key={`bg-v-${idx}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={CANVAS_HEIGHT}
                    stroke="#0b1220"
                    strokeWidth={1}
                  />
                );
              },
            )}
            {/* horizontal */}
            {Array.from({ length: Math.floor(CANVAS_HEIGHT / 28) + 1 }).map(
              (_, idx) => {
                const y = idx * 28;
                return (
                  <line
                    key={`bg-h-${idx}`}
                    x1={0}
                    y1={y}
                    x2={CANVAS_WIDTH}
                    y2={y}
                    stroke="#0b1220"
                    strokeWidth={1}
                  />
                );
              },
            )}
          </g>

          {/* foam block */}
          <rect
            x={blockOffset.x}
            y={blockOffset.y}
            width={blockPx.width}
            height={blockPx.height}
            rx={4}
            ry={4}
            fill="#e5e7eb" // light gray block
            stroke="#cbd5f5"
            strokeWidth={2}
          />

          {/* 0.5" grid inside block */}
          {drawInchGrid(block, blockPx, blockOffset)}

          {/* 0.5" inner wall (dashed) */}
          <rect
            x={
              blockOffset.x +
              (innerWall.leftIn / block.lengthIn) * blockPx.width
            }
            y={
              blockOffset.y + (innerWall.topIn / block.widthIn) * blockPx.height
            }
            width={
              blockPx.width *
              ((innerWall.rightIn - innerWall.leftIn) / block.lengthIn)
            }
            height={
              blockPx.height *
              ((innerWall.bottomIn - innerWall.topIn) / block.widthIn)
            }
            fill="none"
            stroke="#94a3b8"
            strokeDasharray="4 3"
            strokeWidth={1}
          />

          {/* rulers along top + left edges of the block */}
          {drawRulers(block, blockPx, blockOffset)}

          {/* block label */}
          <text
            x={blockOffset.x + blockPx.width / 2}
            y={blockOffset.y - 10}
            textAnchor="middle"
            className="fill-slate-300 text-[10px]"
          >
            Block: {block.lengthIn}×{block.widthIn}×{block.thicknessIn}" thick
          </text>

          {/* cavities */}
          {cavities.map((cavity) => {
            const cavWidthPx =
              (cavity.lengthIn / block.lengthIn) * blockPx.width;
            const cavHeightPx =
              (cavity.widthIn / block.widthIn) * blockPx.height;

            const cavX = blockOffset.x + cavity.x * blockPx.width;
            const cavY = blockOffset.y + cavity.y * blockPx.height;

            const isSelected = cavity.id === selectedId;
            const isHovered = cavity.id === hoveredId;
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

            const strokeColor = isSelected
              ? "#38bdf8"
              : isHovered
              ? "#f97316"
              : "#9ca3af";
            const strokeWidth = isSelected || isHovered ? 2 : 1;
            const fillColor = isSelected ? "#cbd5f5" : "#e5e7eb"; // cavities slightly darker than block

            return (
              <g
                key={cavity.id}
                onMouseEnter={() => setHoveredId(cavity.id)}
                onMouseLeave={() =>
                  setHoveredId((current) =>
                    current === cavity.id ? null : current,
                  )
                }
              >
                {isCircle ? (
                  <circle
                    cx={cavX + cavWidthPx / 2}
                    cy={cavY + cavHeightPx / 2}
                    r={Math.min(cavWidthPx, cavHeightPx) / 2}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                    style={{ cursor: "move" }}
                  />
                ) : (
                  <rect
                    x={cavX}
                    y={cavY}
                    width={cavWidthPx}
                    height={cavHeightPx}
                    rx={cornerRadiusPx}
                    ry={cornerRadiusPx}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                    style={{ cursor: "move" }}
                  />
                )}

                {/* label (computed from dims so it always matches the cavity size) */}
                <text
                  x={cavX + cavWidthPx / 2}
                  y={cavY + cavHeightPx / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-700 text-[9px]"
                  onMouseDown={(e) => handleCavityMouseDown(e, cavity)}
                  style={{ cursor: "move" }}
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
                  fill={isSelected ? "#38bdf8" : "#64748b"}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                  onMouseDown={(e) => handleResizeMouseDown(e, cavity)}
                  style={{ cursor: "nwse-resize" }}
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
        stroke="#e5e7eb"
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
        stroke="#e5e7eb"
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

// Small inch rulers along the top and left of the block
function drawRulers(
  block: LayoutModel["block"],
  blockPx: { width: number; height: number },
  blockOffset: { x: number; y: number },
) {
  const topTicks = [];
  const leftTicks = [];

  // Top ruler (length direction)
  for (let xIn = 0; xIn <= block.lengthIn; xIn += 0.5) {
    const x = blockOffset.x + (xIn / block.lengthIn) * blockPx.width;
    const isMajor = Math.abs(xIn - Math.round(xIn)) < 1e-6; // whole inches
    const tickHeight = isMajor ? 10 : 5;

    topTicks.push(
      <line
        key={`rt-${xIn.toFixed(2)}`}
        x1={x}
        y1={blockOffset.y - 4}
        x2={x}
        y2={blockOffset.y - 4 - tickHeight}
        stroke="#475569"
        strokeWidth={1}
      />,
    );

    if (isMajor && xIn > 0) {
      topTicks.push(
        <text
          key={`rt-label-${xIn.toFixed(2)}`}
          x={x}
          y={blockOffset.y - 4 - tickHeight - 3}
          textAnchor="middle"
          className="fill-slate-400 text-[9px]"
        >
          {xIn}"
        </text>,
      );
    }
  }

  // Left ruler (width direction)
  for (let yIn = 0; yIn <= block.widthIn; yIn += 0.5) {
    const y = blockOffset.y + (yIn / block.widthIn) * blockPx.height;
    const isMajor = Math.abs(yIn - Math.round(yIn)) < 1e-6;
    const tickWidth = isMajor ? 10 : 5;

    leftTicks.push(
      <line
        key={`rl-${yIn.toFixed(2)}`}
        x1={blockOffset.x - 4}
        y1={y}
        x2={blockOffset.x - 4 - tickWidth}
        y2={y}
        stroke="#475569"
        strokeWidth={1}
      />,
    );

    if (isMajor && yIn > 0) {
      leftTicks.push(
        <text
          key={`rl-label-${yIn.toFixed(2)}`}
          x={blockOffset.x - 4 - tickWidth - 2}
          y={y + 3}
          textAnchor="end"
          className="fill-slate-400 text-[9px]"
        >
          {yIn}"
        </text>,
      );
    }
  }

  return (
    <g>
      {topTicks}
      {leftTicks}
    </g>
  );
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

function computeSpacing(
  cav: Cavity,
  block: LayoutModel["block"],
  cavities: Cavity[],
  blockPx: { width: number; height: number },
  blockOffset: { x: number; y: number },
): SpacingInfo {
  const cavLeftIn = cav.x * block.lengthIn;
  const cavTopIn = cav.y * block.widthIn;
  const cavRightIn = cavLeftIn + cav.lengthIn;
  const cavBottomIn = cavTopIn + cav.widthIn;

  const leftIn = cavLeftIn - WALL_IN;
  const rightIn = block.lengthIn - WALL_IN - cavRightIn;
  const topIn = cavTopIn - WALL_IN;
  const bottomIn = block.widthIn - WALL_IN - cavBottomIn;

  const cavLeftPx = blockOffset.x + (cavLeftIn / block.lengthIn) * blockPx.width;
  const cavRightPx =
    blockOffset.x + (cavRightIn / block.lengthIn) * blockPx.width;
  const cavTopPx = blockOffset.y + (cavTopIn / block.widthIn) * blockPx.height;
  const cavBottomPx =
    blockOffset.y + (cavBottomIn / block.widthIn) * blockPx.height;

  const leftWallPx = blockOffset.x + (WALL_IN / block.lengthIn) * blockPx.width;
  const rightWallPx =
    blockOffset.x + blockPx.width - (WALL_IN / block.lengthIn) * blockPx.width;
  const topWallPx = blockOffset.y + (WALL_IN / block.widthIn) * blockPx.height;
  const bottomWallPx =
    blockOffset.y +
    blockPx.height -
    (WALL_IN / block.widthIn) * blockPx.height;

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

    const oLeftPx = blockOffset.x + (oLeftIn / block.lengthIn) * blockPx.width;
    const oRightPx =
      blockOffset.x + (oRightIn / block.lengthIn) * blockPx.width;
    const oTopPx = blockOffset.y + (oTopIn / block.widthIn) * blockPx.height;
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
              Math.min(cavBottomPx, oBottomPx)) / 2,
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
              Math.min(cavRightPx, oRightPx)) / 2,
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
      {/* left wall */}
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
            className={
              edgeDims.leftIn.toFixed(3) === "0.500"
                ? "fill-sky-400 text-[9px]"
                : "fill-slate-600 text-[9px]"
            }
          >
            {edgeDims.leftIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* right wall */}
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
            className={
              edgeDims.rightIn.toFixed(3) === "0.500"
                ? "fill-sky-400 text-[9px]"
                : "fill-slate-600 text-[9px]"
            }
          >
            {edgeDims.rightIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* top wall */}
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
            className={
              edgeDims.topIn.toFixed(3) === "0.500"
                ? "fill-sky-400 text-[9px]"
                : "fill-slate-600 text-[9px]"
            }
          >
            {edgeDims.topIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* bottom wall */}
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
            className={
              edgeDims.bottomIn.toFixed(3) === "0.500"
                ? "fill-sky-400 text-[9px]"
                : "fill-slate-600 text-[9px]"
            }
          >
            {edgeDims.bottomIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* nearest horizontal neighbor */}
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
            className={
              neighborDims.horiz.gapIn.toFixed(3) === "0.500"
                ? "fill-emerald-300 text-[9px]"
                : "fill-emerald-700 text-[9px]"
            }
          >
            {neighborDims.horiz.gapIn.toFixed(3)}"
          </text>
        </g>
      )}

      {/* nearest vertical neighbor */}
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
            className={
              neighborDims.vert.gapIn.toFixed(3) === "0.500"
                ? "fill-emerald-300 text-[9px]"
                : "fill-emerald-700 text-[9px]"
            }
          >
            {neighborDims.vert.gapIn.toFixed(3)}"
          </text>
        </g>
      )}
    </g>
  );
}
