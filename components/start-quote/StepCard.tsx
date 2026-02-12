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
    <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-widest text-sky-300/80">
            {title}
          </div>
          {hint ? (
            <div className="mt-1 text-xs text-slate-400">{hint}</div>
          ) : null}
        </div>
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}
