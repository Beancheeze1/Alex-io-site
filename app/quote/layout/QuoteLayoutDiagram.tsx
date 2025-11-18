// app/quote/layout/QuoteLayoutDiagram.tsx
"use client";

import React from "react";

type Props = {
  dims?: string;
  qty?: number | null;
  cavityDims?: string[];
};

function parseDims(dims?: string) {
  if (!dims) return { L: 0, W: 0, H: 0 };
  const parts = dims
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/×/g, "x")
    .split("x")
    .map((s) => Number(s.trim()));
  return {
    L: parts[0] || 0,
    W: parts[1] || 0,
    H: parts[2] || 0,
  };
}

export default function QuoteLayoutDiagram({ dims, qty, cavityDims }: Props) {
  const { L, W } = parseDims(dims);
  const hasDims = L > 0 && W > 0;

  const cavities = (cavityDims || []).filter(Boolean);
  const count = cavities.length || 1;

  // Simple layout grid for cavities
  const cols = Math.min(count, 4);
  const rows = Math.ceil(count / cols);

  const viewWidth = 220;
  const viewHeight = 140;
  const padding = 16;
  const blockWidth = viewWidth - padding * 2;
  const blockHeight = viewHeight - padding * 2;

  const aspect = hasDims ? L / W : 1;
  let drawWidth = blockWidth;
  let drawHeight = blockHeight;
  if (aspect > 1) {
    drawHeight = blockHeight / aspect;
  } else if (aspect < 1) {
    drawWidth = blockWidth * aspect;
  }

  const blockX = (viewWidth - drawWidth) / 2;
  const blockY = (viewHeight - drawHeight) / 2;

  const cellW = drawWidth / cols;
  const cellH = drawHeight / rows;

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
          width={drawWidth}
          height={drawHeight}
          rx={8}
          ry={8}
          fill="#eef2ff"
          stroke="#c7d2fe"
          strokeWidth={1}
        />

        {/* Cavities */}
        {Array.from({ length: count }).map((_, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          const x = blockX + col * cellW + cellW * 0.12;
          const y = blockY + row * cellH + cellH * 0.12;
          const w = cellW * 0.76;
          const h = cellH * 0.76;

          return (
            <rect
              key={idx}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={4}
              ry={4}
              fill="#ffffff"
              stroke="#6366f1"
              strokeWidth={0.8}
            />
          );
        })}

        {/* Simple center label */}
        {hasDims && (
          <text
            x={viewWidth / 2}
            y={blockY - 4}
            textAnchor="middle"
            fontSize={10}
            fill="#374151"
          >
            {`${L} × ${W} in (top view)`}
          </text>
        )}
      </svg>

      <div style={{ marginTop: 8, fontSize: 12, color: "#374151" }}>
        {dims && (
          <div>
            <strong>Block:</strong> {dims}{" "}
            {qty != null && !Number.isNaN(qty) ? `• Qty ${qty}` : null}
          </div>
        )}
        {cavities.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <strong>Cavities:</strong>{" "}
            {cavities.join(", ")}
          </div>
        )}
      </div>

      <p
        style={{
          margin: "6px 0 0 0",
          fontSize: 11,
          color: "#6b7280",
          lineHeight: 1.4,
        }}
      >
        Not to scale — this is a simple top-view style layout to help visualize
        how the cavities sit inside the foam block.
      </p>
    </div>
  );
}
