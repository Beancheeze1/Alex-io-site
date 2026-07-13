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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
      <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
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
                    s.state === "done" ? "bg-[var(--action-primary)]" : "bg-[var(--border)]",
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
                    ? "font-medium text-[var(--text-primary)]"
                    : s.state === "done"
                      ? "font-medium text-[var(--text-secondary)]"
                      : "text-[var(--text-faint)]",
                ].join(" ")}
              >
                {s.label}
              </div>
              {s.state === "active" ? (
                <div className="mt-0.5 text-[11px] font-medium text-[var(--text-muted)] tracking-wide">
                  ← you are here
                </div>
              ) : s.state === "done" ? (
                <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
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
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--action-primary)]">
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="h-5 w-5 rounded-full border-2 border-[var(--action-primary)] bg-[var(--surface-card)] shadow-[0_0_0_3px_rgba(43,43,40,0.12)]" />
    );
  }
  return (
    <div className="h-5 w-5 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)]" />
  );
}
