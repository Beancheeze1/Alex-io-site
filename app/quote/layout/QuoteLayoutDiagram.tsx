// app/quote/layout/QuoteLayoutDiagram.tsx
"use client";

import React from "react";

type Props = {
  dims?: string;
  qty?: number | null;
  cavityDims?: string[];
};

type ParsedDims = {
  L: number;
  W: number;
  H: number;
  label: string;
};

function parseDims(str?: string): ParsedDims {
  if (!str) {
    return { L: 0, W: 0, H: 0, label: "" };
  }

  const cleaned = str.toLowerCase().replace(/"/g, "").replace(/×/g, "x");

  // Pull out up to three numbers
  const nums = cleaned
    .split("x")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  const L = nums[0] || 0;
  const W = nums[1] || 0;
  const H = nums[2] || 0;

  const pieces: string[] = [];
  if (L && W) {
    pieces.push(`${L} × ${W}`);
  } else if (L || W) {
    pieces.push(String(L || W));
  }
  if (H) {
    pieces.push(`${H}`);
  }

  const label =
    pieces.length === 3
      ? `${pieces[0]} × ${pieces[2]} in`
      : pieces.length
      ? `${pieces.join(" × ")} in`
      : "";

  return { L, W, H, label };
}

type ParsedCavity = {
  L: number;
  W: number;
  H: number;
  label: string;
};

function parseCavities(cavityDims?: string[]): ParsedCavity[] {
  if (!cavityDims || cavityDims.length === 0) return [];

  return cavityDims
    .filter((s) => !!s)
    .map((raw) => {
      const cleaned = raw
        .toLowerCase()
        .replace(/"/g, "")
        .replace(/×/g, "x")
        .replace(/ø/gi, "x"); // treat Ø like a diameter ~ square for top view

      const nums = cleaned
        .split("x")
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));

      const L = nums[0] || 0;
      const W = nums[1] || 0;
      const H = nums[2] || 0;

      const pieces: string[] = [];
      if (L && W) {
        pieces.push(`${L} × ${W}`);
      } else if (L || W) {
        pieces.push(String(L || W));
      }
      if (H) {
        pieces.push(`${H}`);
      }

      const label =
        pieces.length === 3
          ? `${pieces[0]} × ${pieces[2]} in deep`
          : pieces.length
          ? `${pieces.join(" × ")} in`
          : raw.trim();

      return { L, W, H, label };
    });
}

export default function QuoteLayoutDiagram({ dims, qty, cavityDims }: Props) {
  const block = parseDims(dims);
  const cavities = parseCavities(cavityDims);
  const cavityCount = cavities.length || 0;
  const hasDims = block.L > 0 && block.W > 0;

  // --- SVG geometry ---------------------------------------------------------
  const viewWidth = 260;
  const viewHeight = 160;
  const padding = 20;

  // Base "canvas" area inside padding
  const maxBlockWidth = viewWidth - padding * 2;
  const maxBlockHeight = viewHeight - padding * 2;

  // Scale block to fit canvas, preserving aspect
  let drawBlockWidth = maxBlockWidth;
  let drawBlockHeight = maxBlockHeight;

  if (hasDims) {
    const aspect = block.L / block.W || 1;
    if (aspect >= 1) {
      // Wider than tall
      drawBlockWidth = maxBlockWidth;
      drawBlockHeight = maxBlockWidth / aspect;
      if (drawBlockHeight > maxBlockHeight) {
        drawBlockHeight = maxBlockHeight;
      }
    } else {
      // Taller than wide
      drawBlockHeight = maxBlockHeight;
      drawBlockWidth = maxBlockHeight * aspect;
      if (drawBlockWidth > maxBlockWidth) {
        drawBlockWidth = maxBlockWidth;
      }
    }
  }

  const blockX = (viewWidth - drawBlockWidth) / 2;
  const blockY = (viewHeight - drawBlockHeight) / 2;

  // Scale factor: drawing units per inch
  const scale =
    hasDims && block.L > 0 && block.W > 0
      ? Math.min(drawBlockWidth / block.L, drawBlockHeight / block.W)
      : 0;

  // Layout cavities as a centered grid inside the block, scaled by their L/W
  const cavitiesToDraw =
    cavities.length > 0 ? cavities : [{ L: 0, W: 0, H: 0, label: "" }];

  const n = cavitiesToDraw.length;
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);

  // Cell size inside the block area
  const cellW = drawBlockWidth / cols;
  const cellH = drawBlockHeight / rows;

  // Helper to compute cavity rect within a cell, in block coordinates
  function cavityRect(idx: number) {
    const row = Math.floor(idx / cols);
    const col = idx % cols;

    const cellX = blockX + col * cellW;
    const cellY = blockY + row * cellH;

    const cav = cavitiesToDraw[idx];
    let w = cellW * 0.7;
    let h = cellH * 0.7;

    if (scale > 0 && cav.L > 0 && cav.W > 0) {
      // Try to draw cavity to scale, but cap at 80% of cell size
      const wScaled = cav.L * scale;
      const hScaled = cav.W * scale;
      const maxW = cellW * 0.8;
      const maxH = cellH * 0.8;

      const scaleFactor = Math.min(
        1,
        maxW / wScaled || 1,
        maxH / hScaled || 1
      );

      w = Math.max(6, wScaled * scaleFactor);
      h = Math.max(6, hScaled * scaleFactor);
    }

    const x = cellX + (cellW - w) / 2;
    const y = cellY + (cellH - h) / 2;

    return { x, y, w, h };
  }

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid #e5e7eb",
        padding: 12,
        background: "#f9fafb",
      }}
    >
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label="Foam block layout preview"
        style={{ width: "100%", display: "block" }}
      >
        {/* Outer block */}
        <rect
          x={blockX}
          y={blockY}
          width={drawBlockWidth}
          height={drawBlockHeight}
          rx={10}
          ry={10}
          fill="#eef2ff"
          stroke="#c7d2fe"
          strokeWidth={1}
        />

        {/* Block top-view label */}
        {hasDims && (
          <text
            x={viewWidth / 2}
            y={blockY - 6}
            textAnchor="middle"
            fontSize={10}
            fill="#374151"
          >
            {`${block.L} × ${block.W} in (top view)`}
          </text>
        )}

        {/* Cavities */}
        {cavitiesToDraw.map((cav, idx) => {
          const { x, y, w, h } = cavityRect(idx);
          const label = `C${idx + 1}`;

          return (
            <g key={idx}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={4}
                ry={4}
                fill="#ffffff"
                stroke="#6366f1"
                strokeWidth={0.9}
              />
              {/* Cavity number in the middle */}
              <text
                x={x + w / 2}
                y={y + h / 2 + 3}
                textAnchor="middle"
                fontSize={9}
                fill="#374151"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Summary underneath */}
      <div style={{ marginTop: 8, fontSize: 12, color: "#374151" }}>
        {dims && (
          <div>
            <strong>Block:</strong>{" "}
            {block.label
              ? `${block.label} thick`
              : dims}
            {qty != null && !Number.isNaN(qty) ? ` • Qty ${qty}` : null}
          </div>
        )}

        {cavities.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <strong>Cavities:</strong>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {cavities.map((cav, idx) => (
                <li key={idx} style={{ margin: "1px 0" }}>
                  <span style={{ fontWeight: 500 }}>{`Cavity ${
                    idx + 1
                  } — `}</span>
                  {cav.label || "size TBD"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p
        style={{
          margin: "8px 0 0 0",
          fontSize: 11,
          color: "#6b7280",
          lineHeight: 1.4,
        }}
      >
        Not to scale for machining — this is a visual aid only, showing how the
        cavities sit inside the foam block. Final clearances and performance
        are confirmed during engineering review.
      </p>
    </div>
  );
}
