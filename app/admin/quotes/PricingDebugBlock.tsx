// Optional: app/admin/quotes/PricingDebugBlock.tsx
"use client";

import * as React from "react";
import type { PricingBreakdown } from "@/app/lib/pricing/compute";

type Props = {
  calcResult: any | null;
  breakdown: PricingBreakdown | null;
};

export function PricingDebugBlock({ calcResult, breakdown }: Props) {
  if (!calcResult && !breakdown) return null;

  return (
    <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-100">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          Pricing Debug
        </div>
        <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px]">
          Admin only · does not affect pricing
        </span>
      </div>

      <p className="mb-3 text-[11px] text-amber-100/80">
        Live view of the raw <code className="font-mono">/api/quotes/calc</code>{" "}
        output next to the breakdown object. If numbers look off, compare these
        two to see whether the issue is the engine inputs or how we render them.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Left: calc result from /api/quotes/calc */}
        <div className="rounded-lg border border-amber-500/30 bg-black/40 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
            Raw calc result
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-black/60 p-2 font-mono text-[10px] leading-snug">
            {calcResult
              ? JSON.stringify(calcResult, null, 2)
              : "// no calcResult available"}
          </pre>
        </div>

        {/* Right: PricingBreakdown used by UI */}
        <div className="rounded-lg border border-amber-500/30 bg-black/40 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
            PricingBreakdown
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-black/60 p-2 font-mono text-[10px] leading-snug">
            {breakdown
              ? JSON.stringify(breakdown, null, 2)
              : "// no breakdown object available"}
          </pre>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-amber-200/80">
        Tip: watch{" "}
        <code className="font-mono">price_per_ci</code>,{" "}
        <code className="font-mono">kerf_pct</code>,{" "}
        <code className="font-mono">min_charge</code>,{" "}
        <code className="font-mono">markup_factor</code>, and{" "}
        <code className="font-mono">setup_fee</code> as you tweak the admin
        knobs. Both sides should move together.
      </p>
    </div>
  );
}
