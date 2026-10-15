// components/admin/FreightSettingsEditor.tsx
//
// Step 30: Admin -> Settings -> Freight. Ship-from ZIP, freight terms,
// free freight over $X, markup, and the weight / zone table (parcel $/lb and
// LTL $/pallet by distance zone, carton and pallet sizes). Rules:
// app/lib/freight-core.ts. Saved with the rest of the settings.

"use client";

import * as React from "react";
import { FREIGHT_TERMS, TERMS_LABEL, ZONES, type FreightSettings, type FreightTerms } from "@/app/lib/freight-core";

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]";

type NumKey = {
  [K in keyof FreightSettings]: FreightSettings[K] extends number ? K : never;
}[keyof FreightSettings];

export default function FreightSettingsEditor({
  value,
  onChange,
}: {
  value: FreightSettings;
  onChange: (next: FreightSettings) => void;
}) {
  const v = value;
  const set = (patch: Partial<FreightSettings>) => onChange({ ...v, ...patch });
  const numField = (k: NumKey, label: string, step = "1", width = "w-20") => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        aria-label={label}
        data-freight={k}
        className={`${width} ${inputCls}`}
        value={v[k]}
        onChange={(e) => set({ [k]: Number(e.target.value) || 0 } as Partial<FreightSettings>)}
      />
    </label>
  );
  const setArr = (k: "zone_miles" | "parcel_per_lb" | "ltl_per_pallet", i: number, val: string) => {
    const next = [...v[k]];
    next[i] = Number(val) || 0;
    set({ [k]: next } as Partial<FreightSettings>);
  };
  const toggleTerm = (t: FreightTerms, on: boolean) => {
    const allowed = on ? Array.from(new Set([...v.terms_allowed, t])) : v.terms_allowed.filter((x) => x !== t);
    set({
      terms_allowed: FREIGHT_TERMS.filter((x) => allowed.includes(x)),
      default_terms: allowed.includes(v.default_terms) ? v.default_terms : (allowed[0] ?? v.default_terms),
    });
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4" data-freight-settings>
      <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Freight</h2>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">Ship-from ZIP (blank = rough % estimate)</span>
          <input
            type="text"
            maxLength={10}
            aria-label="Ship-from ZIP"
            data-freight="ship_from_zip"
            placeholder="e.g. 44875"
            className={`w-28 ${inputCls}`}
            value={v.ship_from_zip}
            onChange={(e) => set({ ship_from_zip: e.target.value.trim() })}
          />
        </label>
        {numField("free_over_usd", "Free freight over $ (0 = off)", "1", "w-28")}
        {numField("markup_pct", "Freight markup %", "0.5")}
      </div>

      <div className="mt-4 grid gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">Freight terms buyers can choose (default marked)</span>
        {FREIGHT_TERMS.map((t) => (
          <div key={t} className="flex items-center gap-3 text-[var(--text-primary)]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-freight-term={t}
                checked={v.terms_allowed.includes(t)}
                onChange={(e) => toggleTerm(t, e.target.checked)}
              />
              {TERMS_LABEL[t]}
            </label>
            <label className="flex items-center gap-1 text-[var(--text-secondary)]">
              <input
                type="radio"
                name="freight-default-terms"
                data-freight-default={t}
                disabled={!v.terms_allowed.includes(t)}
                checked={v.default_terms === t}
                onChange={() => set({ default_terms: t })}
              />
              default
            </label>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="text-xs" data-freight-zones>
          <thead>
            <tr className="text-left text-[var(--text-secondary)]">
              <th className="pr-3 font-normal">Zone</th>
              <th className="pr-3 font-normal">Miles up to</th>
              <th className="pr-3 font-normal">Parcel $/lb</th>
              <th className="pr-3 font-normal">LTL $/pallet</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ZONES }, (_, i) => (
              <tr key={i}>
                <td className="pr-3 text-[var(--text-primary)]">{i + 1}</td>
                <td className="pr-3">
                  {i < ZONES - 1 ? (
                    <input
                      type="number"
                      min="0"
                      aria-label={`Zone ${i + 1} miles`}
                      className={`w-20 ${inputCls}`}
                      value={v.zone_miles[i]}
                      onChange={(e) => setArr("zone_miles", i, e.target.value)}
                    />
                  ) : (
                    <span className="text-[var(--text-faint)]">beyond</span>
                  )}
                </td>
                <td className="pr-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`Zone ${i + 1} parcel $/lb`}
                    className={`w-20 ${inputCls}`}
                    value={v.parcel_per_lb[i]}
                    onChange={(e) => setArr("parcel_per_lb", i, e.target.value)}
                  />
                </td>
                <td className="pr-3">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    aria-label={`Zone ${i + 1} LTL $/pallet`}
                    className={`w-24 ${inputCls}`}
                    value={v.ltl_per_pallet[i]}
                    onChange={(e) => setArr("ltl_per_pallet", i, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-4">
        {numField("parcel_per_carton_usd", "Parcel $ per carton", "0.5")}
        {numField("parcel_max_lb", "Parcel up to (billable lb)")}
        {numField("parcel_max_cartons", "Parcel up to (cartons)")}
        {numField("ltl_min_usd", "LTL minimum $")}
        {numField("carton_l_in", "Carton L (in)")}
        {numField("carton_w_in", "Carton W (in)")}
        {numField("carton_h_in", "Carton H (in)")}
        {numField("carton_fill_pct", "Carton fill %")}
        {numField("carton_weight_lb", "Carton weight (lb)", "0.1")}
        {numField("dim_divisor", "Dim weight divisor")}
        {numField("pallet_l_in", "Pallet L (in)")}
        {numField("pallet_w_in", "Pallet W (in)")}
        {numField("pallet_max_h_in", "Pallet max height (in)")}
        {numField("pallet_weight_lb", "Pallet weight (lb)")}
        {numField("pallet_max_lb", "Pallet max (lb)")}
      </div>

      <p className="mt-3 text-[11px] text-[var(--text-faint)]">
        Freight = weight and size from the quote (foam block x density in your cartons; boxes flat by board), zone =
        straight-line miles from your ZIP to the ship-to ZIP. Parcel when it fits your parcel limits (billable = the
        larger of actual and dim weight), otherwise LTL by pallet. With prepaid &amp; add the freight is part of the
        quote total. Staff can type the freight on any quote.
      </p>
    </div>
  );
}
