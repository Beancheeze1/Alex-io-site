"use client";

import { useMemo, useState, useEffect } from "react";

type SkiveApplied = {
  needsSkive?: boolean;
  skiveChargeEach?: number;
};

type Props = {
  qty?: number;
  applied?: SkiveApplied;
  /** optional client-side callback – name ends with Action to satisfy Next lint */
  onChangeEachAction?: (value: number) => void;
};

export default function SkiveCard({
  qty = 0,
  applied,
  onChangeEachAction,
}: Props) {
  const [needsSkive, setNeedsSkive] = useState<boolean>(!!applied?.needsSkive);
  const [each, setEach] = useState<number>(applied?.skiveChargeEach ?? 0);

  // keep local state in sync if server sends new values
  useEffect(() => {
    if (applied) {
      if (typeof applied.needsSkive === "boolean") setNeedsSkive(applied.needsSkive);
      if (typeof applied.skiveChargeEach === "number") setEach(applied.skiveChargeEach);
    }
  }, [applied?.needsSkive, applied?.skiveChargeEach]);

  const total = useMemo(() => (needsSkive ? qty * each : 0), [needsSkive, qty, each]);

  function handleToggle(val: boolean) {
    setNeedsSkive(val);
  }

  function handleEachChange(v: string) {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) {
      setEach(parsed);
      onChangeEachAction?.(parsed); // optional callback if you want to persist to server
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-neutral-900">Skiving Upcharge</h3>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <span className="text-neutral-600">Needs Skive</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={needsSkive}
            onChange={(e) => handleToggle(e.target.checked)}
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs text-neutral-500 mb-1">Quantity</div>
          <div className="rounded-lg border bg-neutral-50 px-3 py-2 text-neutral-900">{qty}</div>
        </div>

        <div>
          <label className="text-xs text-neutral-500 mb-1 block">Upcharge (each)</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-2 text-neutral-400">$</span>
            <input
              type="number"
              min={0}
              step={0.01}
              className="w-full rounded-lg border px-6 py-2"
              value={each}
              onChange={(e) => handleEachChange(e.target.value)}
              disabled={!needsSkive}
            />
          </div>
        </div>

        <div>
          <div className="text-xs text-neutral-500 mb-1">Total Skive Upcharge</div>
          <div className="rounded-lg border bg-neutral-50 px-3 py-2 text-neutral-900">
            {needsSkive ? `$${total.toFixed(2)}` : "—"}
          </div>
        </div>
      </div>

      {!needsSkive && (
        <p className="mt-3 text-xs text-neutral-500">
          Skive not required (thickness in 1&quot; increments). Toggle on if shop requires skiving.
        </p>
      )}
    </div>
  );
}
