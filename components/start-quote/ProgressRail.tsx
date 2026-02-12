// components/start-quote/ProgressRail.tsx
//
// Step A (Skeleton):
// Static progress rail UI used by StartQuoteModal.
// Step states: done | active | upcoming

"use client";

import * as React from "react";

export type ProgressState = "done" | "active" | "upcoming";

export type ProgressStep = {
  key: string;
  label: string;
  state: ProgressState;
};

export default function ProgressRail({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-xs font-semibold tracking-widest text-slate-400">
        PROGRESS
      </div>

      <div className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-start gap-3">
            <div className="mt-[2px] flex flex-col items-center">
              <Dot state={s.state} />
              {i < steps.length - 1 ? (
                <div className="mt-2 h-6 w-px bg-white/10" />
              ) : null}
            </div>

            <div className="min-w-0">
              <div
                className={[
                  "text-sm",
                  s.state === "active"
                    ? "text-white font-semibold"
                    : s.state === "done"
                      ? "text-slate-200"
                      : "text-slate-400",
                ].join(" ")}
              >
                {s.label}
              </div>
              {s.state === "active" ? (
                <div className="mt-1 text-xs text-sky-300/80">
                  You’re here
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dot({ state }: { state: ProgressState }) {
  if (state === "done") {
    return (
      <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.18)]" />
    );
  }
  if (state === "active") {
    return (
      <div className="h-3 w-3 rounded-full bg-[#0B1020] shadow-[0_0_0_2px_rgba(56,189,248,0.6),0_0_18px_rgba(56,189,248,0.25)] border border-sky-400" />
    );
  }
  return <div className="h-3 w-3 rounded-full border border-white/15 bg-white/5" />;
}
