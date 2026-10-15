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

// Step 23: foam cutting (CNC short run / steel-rule die + press) and
// lamination rates. All are the shop's COST; the markup is applied on top.
const FOAM_FIELDS = [
  { key: "cnc_setup_usd", label: "CNC setup ($ per order)", step: "0.01" },
  { key: "cnc_feed_in_per_min", label: "CNC feed rate (inches of cut / minute)", step: "1" },
  { key: "cnc_cost_per_min", label: "CNC machine cost ($ / minute)", step: "0.01" },
  { key: "foam_die_over_qty", label: "Use a steel-rule die at this qty and up (0 = CNC unless forced)", step: "1" },
  { key: "die_base_usd", label: "Die base fee ($ per die)", step: "0.01" },
  { key: "die_rule_per_in_usd", label: "Steel rule ($ / inch)", step: "0.01" },
  { key: "press_setup_usd", label: "Press setup ($ per order)", step: "0.01" },
  { key: "press_rate_per_hr", label: "Press rate ($ / hour)", step: "0.01" },
  { key: "press_hits_per_hr", label: "Press hits per hour", step: "1" },
  { key: "press_parts_per_hit", label: "Parts per hit", step: "1" },
  { key: "lam_setup_usd", label: "Lamination setup ($ per order)", step: "0.01" },
  { key: "lam_per_glue_line_usd", label: "Lamination ($ per glue line, per part)", step: "0.01" },
] as const;
type FoamKey = (typeof FOAM_FIELDS)[number]["key"];

// Step 25: review flag limits (warnings on the quote; never change a price).
const REVIEW_FIELDS = [
  { key: "foam_min_wall_in", label: "Minimum foam wall (in) — edge or between cavities", step: "0.01", dflt: 0.25 },
  { key: "foam_min_feature_in", label: "Narrowest cavity (in)", step: "0.01", dflt: 0.25 },
  { key: "foam_max_block_l_in", label: "Largest block length (in, 0 = don't check)", step: "0.1", dflt: 0 },
  { key: "foam_max_block_w_in", label: "Largest block width (in)", step: "0.1", dflt: 0 },
  { key: "foam_max_block_t_in", label: "Thickest block / layer (in, 0 = don't check)", step: "0.1", dflt: 0 },
] as const;
type ReviewKey = (typeof REVIEW_FIELDS)[number]["key"];

type PricingSettings = {
  skive_upcharge_each: number;
  printing_upcharge_usd: number;   // flat "Art Setup" fee
  printing_upcharge_pct: number;   // % markup on (foam + packaging) when printed
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;

  // NEW
  machining_in3_per_min: number;
  machine_cost_per_min: number;
  markup_factor_default: number;

  die_cut_trigger_qty: number;
  die_cut_upcharge_usd: number;

  cushion_family_order: string[];
} & Record<FoamKey, number> &
  Record<ReviewKey, number>;

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
    printing_upcharge_usd: 0,
    printing_upcharge_pct: 0,
    ratePerCI_default: 0.06,
    ratePerBF_default: 34,
    kerf_pct_default: 0,
    min_charge_default: 0,

    machining_in3_per_min: 3000,
    machine_cost_per_min: 0.65,
    markup_factor_default: 1.45,

    die_cut_trigger_qty: 500,
    die_cut_upcharge_usd: 0,
    ...(Object.fromEntries(FOAM_FIELDS.map((f) => [f.key, f.key === "press_parts_per_hit" ? 1 : 0])) as Record<FoamKey, number>),
    ...(Object.fromEntries(REVIEW_FIELDS.map((f) => [f.key, f.dflt])) as Record<ReviewKey, number>),

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
          printing_upcharge_usd: numberOr(
            (s as any).printing_upcharge_usd,
            prev.printing_upcharge_usd,
          ),
          printing_upcharge_pct: numberOr(
            (s as any).printing_upcharge_pct,
            prev.printing_upcharge_pct,
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

          die_cut_trigger_qty: numberOr(
            (s as any).die_cut_trigger_qty,
            prev.die_cut_trigger_qty,
          ),
          die_cut_upcharge_usd: numberOr(
            (s as any).die_cut_upcharge_usd,
            prev.die_cut_upcharge_usd,
          ),

          cushion_family_order: Array.isArray(
            (s as any).cushion_family_order,
          )
            ? ((s as any).cushion_family_order as string[])
            : prev.cushion_family_order,

          ...(Object.fromEntries(
            FOAM_FIELDS.map((f) => [f.key, numberOr((s as Record<string, unknown>)[f.key], prev[f.key])]),
          ) as Record<FoamKey, number>),
          ...(Object.fromEntries(
            REVIEW_FIELDS.map((f) => [f.key, numberOr((s as Record<string, unknown>)[f.key], prev[f.key])]),
          ) as Record<ReviewKey, number>),
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
          (json && (json.message || json.error)) ||
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
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-4xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Pricing settings
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Global knobs that shape how the pricing engine behaves behind the
              scenes. These are admin-only inputs; customers never see this page.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Top summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              What these settings do
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              These values are the starting point for quotes that don&apos;t have
              material-specific overrides:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-[var(--text-secondary)]">
              <li>Default price-per-cubic-inch and board-foot rates.</li>
              <li>Global minimum charge and kerf waste assumption.</li>
              <li>Skive upcharge for non-1&quot; thicknesses.</li>
              <li>Machine throughput, hourly cost, and markup factor.</li>
            </ul>
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Today these are stored in memory via{" "}
              <span className="font-mono text-[var(--text-secondary)]">
                /api/admin/settings
              </span>
              . In this step we&apos;re not changing the math yet, only
              surfacing knobs for you to tune.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Status
            </div>
            {loading ? (
              <p className="text-xs text-[var(--text-secondary)]">Loading settings…</p>
            ) : err ? (
              <p className="text-xs text-[var(--attention)]">
                Error:{" "}
                <span className="font-mono text-[11px]">{err}</span>
              </p>
            ) : (
              <>
                <p className="text-xs text-[var(--text-secondary)]">
                  Settings loaded from the current server process.
                </p>
                <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                  Changes are effective immediately for any endpoints that read
                  from this route. Values reset on a full redeploy (no DB
                  persistence yet).
                </p>
              </>
            )}
          </div>
        </section>

        {/* Main form */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--text-secondary)]">
          <div className="mb-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Global pricing knobs
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Adjust carefully. These values will eventually drive the same
              numbers you and the customer see on quotes and admin views.
            </p>
          </div>

          {err && !loading && (
            <div className="mb-3 rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-[11px] text-[var(--attention)]">
              {err}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-[var(--text-secondary)]">Loading…</p>
          ) : (
            <div className="space-y-5">
              {/* Skiving & base rates */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                  Skiving &amp; base rates
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Skive upcharge (per piece) — $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.skive_upcharge_each}
                      onChange={(e) =>
                        setNum("skive_upcharge_each")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Art Setup fee (USD)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.printing_upcharge_usd}
                      onChange={(e) =>
                        setNum("printing_upcharge_usd")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Printing upcharge (% of foam + boxes)
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.printing_upcharge_pct}
                      onChange={(e) =>
                        setNum("printing_upcharge_pct")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Default rate ($ / cubic inch)
                    </span>
                    <input
                      type="number"
                      step="0.0001"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.ratePerCI_default}
                      onChange={(e) =>
                        setNum("ratePerCI_default")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Default rate ($ / board foot)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.ratePerBF_default}
                      onChange={(e) =>
                        setNum("ratePerBF_default")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Default kerf waste (%)
                    </span>
                    <input
                      type="number"
                      step="1"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.kerf_pct_default}
                      onChange={(e) =>
                        setNum("kerf_pct_default")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Default minimum charge ($)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.min_charge_default}
                      onChange={(e) =>
                        setNum("min_charge_default")(e.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Tip: Non-1″ thicknesses will apply the skive upcharge per piece
                  when the pricing endpoint detects non-integer thickness.
                </p>
              </div>

              {/* Machine & markup */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                  Markup
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Step 23: the old "machine throughput / cost" knobs were removed
                      here — nothing has priced with them since Step 22. CNC
                      machine time is now under "Foam cutting & lamination". */}
                  <label className="flex flex-col gap-1 text-xs md:col-span-2">
                    <span className="text-[var(--text-secondary)]">
                      Default markup factor (× over raw cost)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-40 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.markup_factor_default}
                      onChange={(e) =>
                        setNum("markup_factor_default")(e.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Applied to foam material and to the foam cutting / lamination
                  rates below.
                </p>
              </div>

              {/* Die-cutting charge */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                  Die-cutting charge
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Trigger quantity (order qty &ge; this)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.die_cut_trigger_qty}
                      onChange={(e) =>
                        setNum("die_cut_trigger_qty")(e.target.value)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Die-cutting upcharge ($)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.die_cut_upcharge_usd}
                      onChange={(e) =>
                        setNum("die_cut_upcharge_usd")(e.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Flat charge applied once when an order's quantity reaches the
                  trigger. Set the upcharge to 0 to keep this off — it never
                  applies unless both values are set above 0. Once you set CNC
                  or die rates below, they replace this fee on new quotes.
                </p>
              </div>

              {/* Step 23: foam cutting & lamination */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4" data-foam-process-settings>
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                  Foam cutting &amp; lamination
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {FOAM_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1 text-xs">
                      <span className="text-[var(--text-secondary)]">{f.label}</span>
                      <input
                        type="number"
                        step={f.step}
                        min="0"
                        className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                        value={settings[f.key]}
                        onChange={(e) => setNum(f.key)(e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Your costs; your markup is added. CNC short run = setup + (inches
                  of cut per part ÷ feed rate) × qty × $/minute. Steel-rule die =
                  base fee + inches of rule × $/inch, once per part (each
                  different layer gets its own die). Press = setup + hits ÷ hits
                  per hour × $/hour. Lamination = setup + glue lines × qty ×
                  $/glue line. Leave CNC and die at 0 to keep the flat
                  die-cutting charge above.
                </p>
              </div>

              {/* Step 25: review flags */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4" data-review-settings>
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                  Foam review checks
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {REVIEW_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1 text-xs">
                      <span className="text-[var(--text-secondary)]">{f.label}</span>
                      <input
                        type="number"
                        step={f.step}
                        min="0"
                        className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                        value={settings[f.key]}
                        onChange={(e) => setNum(f.key)(e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Quotes that break these (plus cavities past the edge, deeper than
                  their layer or overlapping, and foam that doesn&apos;t fit its box)
                  show &quot;Things to check&quot; on the quote, and Release for
                  manufacturing asks you to confirm. They never change a price.
                </p>
              </div>

              {/* Cushion family order */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                  Cushion family priority
                </h2>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    Preferred family order (comma-separated)
                  </span>
                  <input
                    type="text"
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                    placeholder="PE, EPE, PU, EVA"
                    value={settings.cushion_family_order.join(", ")}
                    onChange={(e) =>
                      setArray("cushion_family_order")(e.target.value)
                    }
                  />
                </label>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
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
                  className="rounded-md bg-[var(--action-primary)] px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
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
