// components/start-quote/BoxShapeHint.tsx
//
// Step 39B: shown under a box size when it looks typed in the wrong order
// (a mailer or tray deeper than it is wide). One click swaps to the usual
// order; the buyer can also keep their size (the quote is then flagged for
// staff to check).

"use client";

import * as React from "react";
import { boxShapeIssue } from "@/lib/box-shape";

export default function BoxShapeHint({
  style,
  L,
  W,
  D,
  onUse,
}: {
  style: string | null | undefined;
  L: number | null;
  W: number | null;
  D: number | null;
  onUse: (d: { L: number; W: number; D: number }) => void;
}) {
  const issue = L && W && D ? boxShapeIssue(style, { L, W, D }) : null;
  if (!issue) return null;
  const s = issue.suggestion;
  return (
    <div
      className="mt-3 rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-xs text-[var(--text-primary)]"
      data-box-shape-hint
    >
      <div>{issue.message}</div>
      <button
        type="button"
        onClick={() => onUse(s)}
        className="mt-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-subtle)]"
        data-box-shape-use
      >
        Use {s.L} × {s.W} × {s.D}
      </button>
      <span className="ml-2 text-[var(--text-muted)]">or keep your size and we&apos;ll check it.</span>
    </div>
  );
}
