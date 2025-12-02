// app/admin/settings/page.tsx
//
// Admin pricing settings (Path A / Straight Path).
// - Dark theme to match other admin pages.
// - Reads & writes from /api/admin/settings.
// - Exposes:
//     * Skive upcharge
//     * Default rate $/in³ and $/BF
//     * Default kerf %
//     * Default minimum charge
//     * Machine throughput & cost
//     * Default markup factor
//     * Cushion family priority
//
// NOTE: This only edits inputs stored by /api/admin/settings.
// Actual pricing math is unchanged in this step.

"use client";

import * as React from "react";
import Link from "next/link";

type PricingSettings = {
  skive_upcharge_each: number;
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;

  // NEW
  machining_in3_per_min: number;
  machine_cost_per_min: number;
  markup_factor_default: number;

  cushion_family_order: string[];
};

type SettingsResponse = {
  ok: boolean;
  settings: Partial<PricingSettings>;
};

const numberOr = (v: any, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export default function AdminSettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [settings, setSettings] = React.useState<PricingSettings>({
    skive_upcharge_each: 4.5,
    ratePerCI_default: 0.06,
    ratePerBF_default: 34,
    kerf_pct_default: 0,
    min_charge_default: 0,

    machining_in3_per_min: 3000,
    machine_cost_per_min: 0.65,
    markup_factor_default: 1.45,

    cushion_family_order: ["EPE", "PU", "PE", "EVA"],
  });

  React.useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/admin/settings", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`GET /api/admin/settings ${res.status}`);
        }
        const json: SettingsResponse = await res.json();
        const s = json.settings || (json as any).settings || {};

        if (!active) return;

        setSettings((prev) => ({
          skive_upcharge_each: numberOr(
            (s as any).skive_upcharge_each,
            prev.skive_upcharge_each,
          ),
          ratePerCI_default: numberOr(
            (s as any).ratePerCI_default,
            prev.ratePerCI_default,
          ),
          ratePerBF_default: numberOr(
            (s as any).ratePerBF_default,
            prev.ratePerBF_default,
          ),
          kerf_pct_default: numberOr(
            (s as any).kerf_pct_default,
            prev.kerf_pct_default,
          ),
          min_charge_default: numberOr(
            (s as any).min_charge_default,
            prev.min_charge_default,
          ),

          machining_in3_per_min: numberOr(
            (s as any).machining_in3_per_min,
            prev.machining_in3_per_min,
          ),
          machine_cost_per_min: numberOr(
            (s as any).machine_cost_per_min,
            prev.machine_cost_per_min,
          ),
          markup_factor_default: numberOr(
            (s as any).markup_factor_default,
            prev.markup_factor_default,
          ),

          cushion_family_order: Array.isArray(
            (s as any).cushion_family_order,
          )
            ? ((s as any).cushion_family_order as string[])
            : prev.cushion_family_order,
        }));
      } catch (e: any) {
        console.error("Admin settings load error:", e);
        if (!active) return;
        setErr(e?.message || String(e));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  function setNum<K extends keyof PricingSettings>(key: K) {
    return (v: string) =>
      setSettings((s) => ({ ...s, [key]: Number(v) || 0 }));
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
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        throw new Error(
          (json && (json.error || json.message)) ||
            `PATCH /api/admin/settings ${res.status}`,
        );
      }
    } catch (e: any) {
      console.error("Admin settings save error:", e);
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Pricing settings
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Global knobs that shape how the pricing engine behaves behind the
              scenes. These are admin-only inputs; customers never see this page.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Top summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              What these settings do
            </div>
            <p className="text-xs text-slate-300">
              These values are the starting point for quotes that don&apos;t have
              material-specific overrides:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-slate-300">
              <li>Default price-per-cubic-inch and board-foot rates.</li>
              <li>Global minimum charge and kerf waste assumption.</li>
              <li>Skive upcharge for non-1&quot; thicknesses.</li>
              <li>Machine throughput, hourly cost, and markup factor.</li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Today these are stored in memory via{" "}
              <span className="font-mono text-sky-300">
                /api/admin/settings
              </span>
              . In this step we&apos;re not changing the math yet, only
              surfacing knobs for you to tune.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Status
            </div>
            {loading ? (
              <p className="text-xs text-slate-300">Loading settings…</p>
            ) : err ? (
              <p className="text-xs text-rose-300">
                Error:{" "}
                <span className="font-mono text-[11px]">{err}</span>
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-300">
                  Settings loaded from the current server process.
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Changes are effective immediately for any endpoints that read
                  from this route. Values reset on a full redeploy (no DB
                  persistence yet).
                </p>
              </>
            )}
          </div>
        </section>

        {/* Main form */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Global pricing knobs
            </div>
            <p className="mt-1 text-xs text-slate-300">
              Adjust carefully. These values will eventually drive the same
              numbers you and the customer see on quotes and admin views.
            </p>
          </div>

          {err && !loading && (
            <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
              {err}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-slate-300">Loading…</p>
          ) : (
            <div className="space-y-5">
              {/* Skiving & base rates */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-100">
                  Skiving &amp; base rates
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Skive upcharge (per piece) — $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.skive_upcharge_each}
                      onChange={(e) =>
                        setNum("skive_upcharge_each")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Default rate ($ / cubic inch)
                    </span>
                    <input
                      type="number"
                      step="0.0001"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.ratePerCI_default}
                      onChange={(e) =>
                        setNum("ratePerCI_default")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Default rate ($ / board foot)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.ratePerBF_default}
                      onChange={(e) =>
                        setNum("ratePerBF_default")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Default kerf waste (%)
                    </span>
                    <input
                      type="number"
                      step="1"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.kerf_pct_default}
                      onChange={(e) =>
                        setNum("kerf_pct_default")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Default minimum charge ($)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.min_charge_default}
                      onChange={(e) =>
                        setNum("min_charge_default")(e.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  Tip: Non-1″ thicknesses will apply the skive upcharge per piece
                  when the pricing endpoint detects non-integer thickness.
                </p>
              </div>

              {/* Machine & markup */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-100">
                  Machine throughput &amp; markup
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Machine throughput (in³ / minute)
                    </span>
                    <input
                      type="number"
                      step="1"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.machining_in3_per_min}
                      onChange={(e) =>
                        setNum("machining_in3_per_min")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-300">
                      Machine cost ($ / minute)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.machine_cost_per_min}
                      onChange={(e) =>
                        setNum("machine_cost_per_min")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs md:col-span-2">
                    <span className="text-slate-300">
                      Default markup factor (× over raw cost)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-40 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                      value={settings.markup_factor_default}
                      onChange={(e) =>
                        setNum("markup_factor_default")(e.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  These values will eventually align with the pricing breakdown
                  you see in the quote viewer: material vs. machine vs. markup.
                </p>
              </div>

              {/* Cushion family order */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-100">
                  Cushion family priority
                </h2>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-slate-300">
                    Preferred family order (comma-separated)
                  </span>
                  <input
                    type="text"
                    className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    placeholder="PE, EPE, PU, EVA"
                    value={settings.cushion_family_order.join(", ")}
                    onChange={(e) =>
                      setArray("cushion_family_order")(e.target.value)
                    }
                  />
                </label>
                <p className="mt-3 text-[11px] text-slate-500">
                  Polyethylene and Expanded Polyethylene stay separate families;
                  this only controls which options the advisor prefers when
                  multiple curves could work.
                </p>
              </div>

              {/* Save button */}
              <div className="mt-1 flex justify-end">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-full border border-sky-500/60 bg-sky-600/20 px-4 py-1.5 text-xs font-semibold text-sky-100 shadow-sm transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
