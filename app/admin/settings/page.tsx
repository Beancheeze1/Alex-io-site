// app/admin/settings/page.tsx
//
// Admin pricing settings (global).
// Path A / Straight Path safe:
//  - Edits only in-memory runtime knobs via /api/admin/settings.
//  - No DB writes, no changes to parsing/layout logic.
//  - Feeds the pricing engine (compute.ts) for machine rate/cost & markup,
//    plus defaults for skiving and baseline rates.
//
// Exposed knobs:
//  - skive_upcharge_each         ($/piece for non-1" thicknesses)
//  - ratePerCI_default           ($ / cubic inch baseline)
//  - ratePerBF_default           ($ / board foot baseline)
//  - kerf_pct_default            (default kerf/waste %)
//  - min_charge_default          (default minimum charge)
//  - cushion_family_order        (advisor family priority)
//  - machine_rate_in3_per_min    (machine throughput in³ / minute)
//  - machine_cost_per_min        (machine cost $ / minute)
//  - default_markup_factor       (markup multiplier over cost, e.g. 1.45)

"use client";

import { useEffect, useState } from "react";

type PricingSettings = {
  skive_upcharge_each: number;
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  cushion_family_order: string[];

  // NEW: machining & markup knobs
  machine_rate_in3_per_min: number;
  machine_cost_per_min: number;
  default_markup_factor: number;
};

type SettingsResponse = {
  ok: boolean;
  settings: PricingSettings;
};

const numberOr = (v: any, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [settings, setSettings] = useState<PricingSettings>({
    skive_upcharge_each: 0,
    ratePerCI_default: 0,
    ratePerBF_default: 0,
    kerf_pct_default: 0,
    min_charge_default: 0,
    cushion_family_order: [],

    machine_rate_in3_per_min: 3000,
    machine_cost_per_min: 0.65,
    default_markup_factor: 1.45,
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/admin/settings", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`GET /api/admin/settings ${res.status}`);
        }
        const json: SettingsResponse | any = await res.json();

        // Support both { ok, settings } and older shape where fields are top-level.
        const raw = (json && json.settings) || json;

        setSettings({
          skive_upcharge_each: numberOr(
            raw.skive_upcharge_each,
            0,
          ),
          ratePerCI_default: numberOr(
            raw.ratePerCI_default,
            0,
          ),
          ratePerBF_default: numberOr(
            raw.ratePerBF_default,
            0,
          ),
          kerf_pct_default: numberOr(
            raw.kerf_pct_default,
            0,
          ),
          min_charge_default: numberOr(
            raw.min_charge_default,
            0,
          ),
          cushion_family_order: Array.isArray(
            raw.cushion_family_order,
          )
            ? raw.cushion_family_order
            : [],

          machine_rate_in3_per_min: numberOr(
            raw.machine_rate_in3_per_min,
            3000,
          ),
          machine_cost_per_min: numberOr(
            raw.machine_cost_per_min,
            0.65,
          ),
          default_markup_factor: numberOr(
            raw.default_markup_factor,
            1.45,
          ),
        });
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/settings?t=${Math.random()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        },
      );
      if (!res.ok) {
        throw new Error(`PATCH /api/admin/settings ${res.status}`);
      }
      // Optional: you could re-fetch here, but the local state
      // already reflects what we sent.
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function setNum<K extends keyof PricingSettings>(key: K) {
    return (v: string) =>
      setSettings((s) => ({
        ...s,
        [key]: Number(v) || 0,
      }));
  }

  function setArray<K extends keyof PricingSettings>(key: K) {
    return (v: string) =>
      setSettings((s) => ({
        ...s,
        [key]: v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      }));
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">
        Pricing Settings (global)
      </h1>

      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-2xl border bg-white p-5 shadow">
            <h2 className="mb-3 text-lg font-medium">
              Skiving, defaults & machining
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Skive upcharge */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Skive upcharge (per piece) — $
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded border px-3 py-2"
                  value={settings.skive_upcharge_each}
                  onChange={(e) =>
                    setNum("skive_upcharge_each")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* Default rate / in³ */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Default rate ($ / cubic inch)
                </span>
                <input
                  type="number"
                  step="0.0001"
                  className="rounded border px-3 py-2"
                  value={settings.ratePerCI_default}
                  onChange={(e) =>
                    setNum("ratePerCI_default")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* Default rate / board foot */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Default rate ($ / board foot)
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded border px-3 py-2"
                  value={settings.ratePerBF_default}
                  onChange={(e) =>
                    setNum("ratePerBF_default")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* Default kerf % */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Default kerf waste (%)
                </span>
                <input
                  type="number"
                  step="1"
                  className="rounded border px-3 py-2"
                  value={settings.kerf_pct_default}
                  onChange={(e) =>
                    setNum("kerf_pct_default")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* Default min charge */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Default minimum charge ($)
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded border px-3 py-2"
                  value={settings.min_charge_default}
                  onChange={(e) =>
                    setNum("min_charge_default")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* Cushion family order */}
              <label className="flex flex-col gap-1 md:col-span-1">
                <span className="text-sm opacity-70">
                  Cushion family priority (comma-separated)
                </span>
                <input
                  type="text"
                  className="rounded border px-3 py-2"
                  placeholder="PE, EPE, PU, EVA"
                  value={settings.cushion_family_order.join(
                    ", ",
                  )}
                  onChange={(e) =>
                    setArray("cushion_family_order")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* NEW: machine rate in³/min */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Machine rate (in³ / minute)
                </span>
                <input
                  type="number"
                  step="1"
                  className="rounded border px-3 py-2"
                  value={settings.machine_rate_in3_per_min}
                  onChange={(e) =>
                    setNum("machine_rate_in3_per_min")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* NEW: machine cost $/min */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Machine cost ($ / minute)
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded border px-3 py-2"
                  value={settings.machine_cost_per_min}
                  onChange={(e) =>
                    setNum("machine_cost_per_min")(
                      e.target.value,
                    )
                  }
                />
              </label>

              {/* NEW: default markup factor */}
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">
                  Default markup (× over cost)
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded border px-3 py-2"
                  value={settings.default_markup_factor}
                  onChange={(e) =>
                    setNum("default_markup_factor")(
                      e.target.value,
                    )
                  }
                />
                <span className="text-xs opacity-60">
                  Example: 1.45 = 45% over cost.
                </span>
              </label>
            </div>

            {err && (
              <div className="mt-3 text-sm text-red-600">
                {err}
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-2xl border px-4 py-2 shadow transition hover:shadow-md disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="text-sm opacity-70">
            <p>
              Skive upcharge is applied when the pricing engine detects a
              non-integer inch thickness. Machine rate, machine cost, and
              markup feed directly into the pricing breakdown used on the
              quote print page and email template.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
