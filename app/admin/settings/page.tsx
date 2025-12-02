// app/admin/settings/page.tsx
//
// Global pricing settings (admin).
// Path A / Straight Path safe:
//  - Client-only.
//  - Talks to /api/admin/settings for read/write of a small settings blob.
//  - No changes to pricing math here; this only tunes defaults that
//    the existing engine already knows how to use.
//
// This page focuses on:
//  - Skive upcharge per piece (global default)
//  - Default rate per cubic inch / per board foot
//  - Default kerf waste %
//  - Default minimum charge
//  - Cushion family priority (for advisor-style choices)
//
// Machining time + setup fee + per-material extras are still driven by:
//  - Per-material columns on the materials table
//  - The existing pricing engine / computePricingBreakdown()
// and are *described* here but not directly edited yet.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PricingSettings = {
  skive_upcharge_each: number;
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  cushion_family_order: string[]; // e.g., ["PE","EPE","PU","EVA"]
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
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/admin/settings", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/admin/settings ${res.status}`);
        const json = await res.json();

        // NOTE: We keep the existing contract here (flat keys on json)
        // to avoid breaking your working /api/admin/settings route.
        setSettings({
          skive_upcharge_each: numberOr(json.skive_upcharge_each, 0),
          ratePerCI_default: numberOr(json.ratePerCI_default, 0),
          ratePerBF_default: numberOr(json.ratePerBF_default, 0),
          kerf_pct_default: numberOr(json.kerf_pct_default, 0),
          min_charge_default: numberOr(json.min_charge_default, 0),
          cushion_family_order: Array.isArray(json.cushion_family_order)
            ? json.cushion_family_order
            : [],
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
      const res = await fetch(`/api/admin/settings?t=${Math.random()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`PATCH /api/admin/settings ${res.status}`);
      // (Optional) we could re-fetch here, but Path A says keep it minimal.
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

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
              Global knobs for skiving and default rates. These tune how the
              existing pricing engine behaves for quotes that don&apos;t have a
              more specific override.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {loading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Loading settings…
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Fetching global pricing defaults from the backend.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {/* Main settings card */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-200">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Skiving &amp; default rates
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Skive upcharge (per piece)
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <span className="font-mono text-slate-300">$</span>
                    <span>
                      Applied when the price endpoint detects a non-integer
                      thickness that requires skiving.
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    value={settings.skive_upcharge_each}
                    onChange={(e) =>
                      setNum("skive_upcharge_each")(e.target.value)
                    }
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Default rate ($ / cubic inch)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Used when no material-specific rate is provided.
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    className="mt-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    value={settings.ratePerCI_default}
                    onChange={(e) =>
                      setNum("ratePerCI_default")(e.target.value)
                    }
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Default rate ($ / board foot)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Optional board-foot fallback when quotes are rounded to BF.
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    value={settings.ratePerBF_default}
                    onChange={(e) =>
                      setNum("ratePerBF_default")(e.target.value)
                    }
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Default kerf waste (%)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Global waste allowance when a specific material doesn&apos;t
                    override kerf_pct.
                  </span>
                  <input
                    type="number"
                    step="1"
                    className="mt-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    value={settings.kerf_pct_default}
                    onChange={(e) =>
                      setNum("kerf_pct_default")(e.target.value)
                    }
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Default minimum charge ($)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Safety net when a material or price book hasn&apos;t
                    specified its own min charge.
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    value={settings.min_charge_default}
                    onChange={(e) =>
                      setNum("min_charge_default")(e.target.value)
                    }
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs md:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Cushion family priority
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Comma-separated list used by advisor-style logic when
                    choosing which foam family to recommend first (e.g.{" "}
                    <span className="font-mono text-sky-300">
                      PE, EPE, PU, EVA
                    </span>
                    ).
                  </span>
                  <input
                    type="text"
                    className="mt-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500"
                    placeholder="PE, EPE, PU, EVA"
                    value={settings.cushion_family_order.join(", ")}
                    onChange={(e) =>
                      setArray("cushion_family_order")(e.target.value)
                    }
                  />
                </label>
              </div>

              {err && (
                <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  Error:{" "}
                  <span className="font-mono text-[11px]">{err}</span>
                </div>
              )}

              <div className="mt-4 flex gap-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-full border border-sky-500/60 bg-sky-500/10 px-4 py-2 text-xs font-medium text-sky-100 shadow-sm hover:bg-sky-500/20 hover:shadow-md disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            </section>

            {/* Sidebar: machining & extras explanation */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-xs text-slate-200">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Machining, setup &amp; extras
              </div>
              <p className="text-[11px] text-slate-300">
                This panel covers global defaults. Additional &quot;extras&quot;
                are pulled from:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-slate-300">
                <li>
                  <span className="font-semibold text-sky-300">
                    Per-material fields
                  </span>{" "}
                  (on the{" "}
                  <span className="font-mono text-[11px] text-sky-300">
                    materials
                  </span>{" "}
                  table), such as kerf_waste_pct, min_charge_usd,
                  skiving_upcharge_pct, and any cutting setup fee columns.
                </li>
                <li>
                  The centralized pricing breakdown in{" "}
                  <span className="font-mono text-[11px] text-sky-300">
                    app/lib/pricing/compute.ts
                  </span>
                  , which estimates material cost, machine time, and markup.
                </li>
                <li>
                  The quote calculators (price endpoints) that combine all of
                  the above into per-piece and extended prices.
                </li>
              </ul>
              <p className="mt-3 text-[11px] text-slate-500">
                Next step (future): expose per-material extras (like machining
                setup fees) on the{" "}
                <span className="font-mono text-[11px] text-sky-300">
                  /admin/materials
                </span>{" "}
                page, so you can tune them row-by-row while this panel continues
                to control global defaults.
              </p>

              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300">
                <span className="font-semibold text-sky-300">Tip:</span>{" "}
                Non-1″ thicknesses automatically apply the{" "}
                <span className="font-mono text-[11px]">
                  Skive upcharge (per piece)
                </span>{" "}
                when the price endpoint detects a non-integer inch thickness. In
                addition, any configured{" "}
                <span className="font-mono text-[11px]">min_charge</span> /
                setup fees and machine cost estimates are layered on top inside
                the pricing engine — you&apos;re just deciding the global
                defaults here.
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
