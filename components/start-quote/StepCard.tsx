// components/start-quote/StepCard.tsx
//
// Step A: Reusable card wrapper for step content.
// (In Step B it will be used for each guided step.)

"use client";

import * as React from "react";

export default function StepCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
            {title}
          </div>
          {hint ? (
            <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div>
          ) : null}
        </div>
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}
