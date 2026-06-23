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

      <div className="mt-4 space-y-1">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-start gap-3">
            <div className="mt-[3px] flex flex-col items-center">
              <Dot state={s.state} />
              {i < steps.length - 1 ? (
                <div
                  className={[
                    "mt-1 w-px",
                    s.state === "done" ? "bg-sky-400/60" : "bg-white/10",
                  ].join(" ")}
                  style={{ height: "28px" }}
                />
              ) : null}
            </div>

            <div className="min-w-0 pb-1">
              <div
                className={[
                  "text-sm leading-tight",
                  s.state === "active"
                    ? "font-bold text-white"
                    : s.state === "done"
                      ? "font-medium text-slate-200"
                      : "text-slate-500",
                ].join(" ")}
              >
                {s.label}
              </div>
              {s.state === "active" ? (
                <div className="mt-0.5 text-[11px] font-semibold text-sky-300/90 tracking-wide">
                  ← you are here
                </div>
              ) : s.state === "done" ? (
                <div className="mt-0.5 text-[11px] text-sky-400/60">
                  complete
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
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.18)]">
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="h-5 w-5 rounded-full border-2 border-sky-400 bg-[#0B1020] shadow-[0_0_0_3px_rgba(56,189,248,0.22),0_0_16px_rgba(56,189,248,0.3)]" />
    );
  }
  return (
    <div className="h-5 w-5 rounded-full border border-white/15 bg-white/5" />
  );
}
