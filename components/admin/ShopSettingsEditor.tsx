// components/admin/ShopSettingsEditor.tsx
//
// Step 38C: the old single /admin/settings page, split by job. Each page
// shows one group of settings; all of them load and save through the same
// /api/admin/settings GET/PATCH as before (the whole settings object is
// sent on save, exactly as the single page did), so nothing about how the
// values are stored or priced changes.
//   section "freight" → Pricing → Freight & shipping  (/admin/settings/freight)
//   section "foam"    → Pricing → Foam cutting rates  (/admin/settings/foam)
//   section "terms"   → Shop settings → Quote terms & buyer emails (/admin/settings/terms)

"use client";

import * as React from "react";
import FreightSettingsEditor from "@/components/admin/FreightSettingsEditor";
import { FREIGHT_DEFAULTS, cleanFreightSettings, type FreightSettings } from "@/app/lib/freight-core";

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
  // Step 39L: the sheets parts are laminated from
  { key: "foam_stock_1_in", label: "Stock sheet thickness 1 (in, 0 = not used)", step: "0.125" },
  { key: "foam_stock_2_in", label: "Stock sheet thickness 2 (in)", step: "0.125" },
  { key: "foam_stock_3_in", label: "Stock sheet thickness 3 (in)", step: "0.125" },
  { key: "foam_stock_4_in", label: "Stock sheet thickness 4 (in)", step: "0.125" },
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

  // Step 28: quote terms
  quote_valid_days: number;
  lead_time_text: string;

  // Step 29A: buyer status emails
  buyer_email_accepted: boolean;
  buyer_email_confirmed: boolean;
  buyer_email_released: boolean;
  buyer_email_shipped: boolean;
  reply_to_email: string;

  // Step 29B: reminders
  reminder_expiring_on: boolean;
  reminder_expiring_days: number;
  reminder_followup_on: boolean;
  reminder_followup_days: number;
  staff_digest_on: boolean;
  staff_digest_hour: number;
  staff_digest_to: string;
  shop_timezone: string;

  // Step 30: freight table
  freight: FreightSettings;
} & Record<FoamKey, number> &
  Record<ReviewKey, number>;

type SettingsResponse = {
  ok: boolean;
  settings: Partial<PricingSettings>;
};

const numberOr = (v: any, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// Step 29B: reminders (loaded with fallbacks to what's on screen).
function reminderSettingsFrom(s: Record<string, unknown>, prev: PricingSettings) {
  const b = (k: string, d: boolean) => (typeof s[k] === "boolean" ? (s[k] as boolean) : d);
  const t = (k: string, d: string) => (typeof s[k] === "string" ? String(s[k]) : d);
  return {
    reminder_expiring_on: b("reminder_expiring_on", prev.reminder_expiring_on),
    reminder_expiring_days: numberOr(s.reminder_expiring_days, prev.reminder_expiring_days),
    reminder_followup_on: b("reminder_followup_on", prev.reminder_followup_on),
    reminder_followup_days: numberOr(s.reminder_followup_days, prev.reminder_followup_days),
    staff_digest_on: b("staff_digest_on", prev.staff_digest_on),
    staff_digest_hour: numberOr(s.staff_digest_hour, prev.staff_digest_hour),
    staff_digest_to: t("staff_digest_to", prev.staff_digest_to),
    shop_timezone: t("shop_timezone", prev.shop_timezone),
  };
}

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Mexico_City",
  "Europe/London",
  "UTC",
];

// Step 29A: buyer status emails (on/off per shop).
type BuyerEmailKey = "buyer_email_accepted" | "buyer_email_confirmed" | "buyer_email_released" | "buyer_email_shipped";
const BUYER_EMAIL_FIELDS: { key: BuyerEmailKey; label: string; hint: string }[] = [
  { key: "buyer_email_accepted", label: "Approval received", hint: "When a buyer accepts (or re-approves) a quote." },
  { key: "buyer_email_confirmed", label: "Order confirmed", hint: "When staff confirm the order." },
  { key: "buyer_email_released", label: "In production", hint: "When staff release the quote for manufacturing." },
  { key: "buyer_email_shipped", label: "Shipped", hint: "When staff mark a released order shipped (with the carrier and tracking)." },
];

export type SettingsSection = "freight" | "foam" | "terms";

const SECTION_COPY: Record<SettingsSection, { title: string; intro: string; save: string }> = {
  freight: {
    title: "Freight & shipping",
    intro:
      "Where you ship from, your freight terms and the rate table used to put freight on quotes. Until freight is set up, quotes show a rough shipping estimate instead (below).",
    save: "Save freight settings",
  },
  foam: {
    title: "Foam cutting rates",
    intro:
      "Your default foam rates, markup, cutting and lamination costs, and the checks that flag a foam layout for review. Material prices are under Pricing → Foam materials.",
    save: "Save foam rates",
  },
  terms: {
    title: "Quote terms & buyer emails",
    intro:
      "How long quotes stay valid, the lead time shown on quotes, which status emails buyers get, where replies go and the reminder emails.",
    save: "Save terms & emails",
  },
};

export default function ShopSettingsEditor({
  section,
  after = null,
}: {
  section: SettingsSection;
  /** Extra cards under the form (Freight & shipping: the rough shipping %). */
  after?: React.ReactNode;
}) {
  const copy = SECTION_COPY[section];
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);
  // Save sends every setting (all three pages share one record), so never
  // save if they didn't load: that would write defaults over the real values.
  const [loadedOk, setLoadedOk] = React.useState(false);
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

    quote_valid_days: 30,
    lead_time_text: "",

    buyer_email_accepted: true,
    buyer_email_confirmed: true,
    buyer_email_released: true,
    buyer_email_shipped: true,
    reply_to_email: "",

    reminder_expiring_on: true,
    reminder_expiring_days: 5,
    reminder_followup_on: true,
    reminder_followup_days: 3,
    staff_digest_on: true,
    staff_digest_hour: 7,
    staff_digest_to: "",
    shop_timezone: "America/New_York",

    freight: FREIGHT_DEFAULTS,

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
          throw new Error(`Could not load settings (${res.status})`);
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
          quote_valid_days: numberOr((s as Record<string, unknown>).quote_valid_days, prev.quote_valid_days),
          lead_time_text:
            typeof (s as Record<string, unknown>).lead_time_text === "string"
              ? String((s as Record<string, unknown>).lead_time_text)
              : prev.lead_time_text,
          ...(Object.fromEntries(
            BUYER_EMAIL_FIELDS.map((f) => {
              const v = (s as Record<string, unknown>)[f.key];
              return [f.key, typeof v === "boolean" ? v : prev[f.key]];
            }),
          ) as Record<BuyerEmailKey, boolean>),
          reply_to_email:
            typeof (s as Record<string, unknown>).reply_to_email === "string"
              ? String((s as Record<string, unknown>).reply_to_email)
              : prev.reply_to_email,
          ...reminderSettingsFrom(s as Record<string, unknown>, prev),
          freight: cleanFreightSettings((s as Record<string, unknown>).freight),
        }));
        setLoadedOk(true);
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
    setSavedMsg(null);
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
            `Save failed (${res.status})`,
        );
      }
      setSavedMsg("Saved. New quotes use these settings.");
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
        {/* Header (Step 38C: one page per job) */}
        <header className="mb-6 border-b border-[var(--border)] pb-5" data-settings-section={section}>
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">{copy.intro}</p>
        </header>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--text-secondary)]">
          {err && !loading && (
            <div className="mb-3 rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-[11px] text-[var(--attention)]">
              {err}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-[var(--text-secondary)]">Loading…</p>
          ) : (
            <div className="space-y-5">
              {section === "foam" ? (
              <>
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
                <p className="mt-2 text-[11px] text-[var(--text-faint)]" data-stock-help>
                  Stock sheets: each foam piece is built from these thicknesses
                  with the fewest sheets (one is skived when they come out
                  thicker). There&apos;s a glue line between sheets, at the floor
                  of every cavity that doesn&apos;t go all the way through, and
                  between layers that are glued together (the top layer of a set
                  is packed loose). Each different sheet gets its own die and
                  each sheet is a press hit. Leave all four at 0 to build each
                  piece from one sheet per cavity depth. Applies to quotes
                  priced from now on; reprice an older quote to use it.
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
              </>
              ) : null}

              {section === "terms" ? (
              <>
              {/* Step 28: quote terms */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4" data-quote-terms>
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Quote terms</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">Quotes are valid for (days, 0 = no expiry)</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      aria-label="Quote valid days"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.quote_valid_days}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, quote_valid_days: Math.max(0, Math.round(Number(e.target.value) || 0)) }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">Lead time (shown on quotes)</span>
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="e.g. 3-4 weeks after approval"
                      aria-label="Lead time"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.lead_time_text}
                      onChange={(e) => setSettings((s) => ({ ...s, lead_time_text: e.target.value }))}
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Buyers can accept a quote until it expires; &quot;Reprice at today&apos;s rates&quot; restarts the
                  clock. Staff can change the expiry date or lead time on any quote.
                </p>
              </div>

              {/* Step 29A: buyer status emails */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4" data-buyer-emails>
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Buyer emails</h2>
                <div className="grid gap-2">
                  {BUYER_EMAIL_FIELDS.map((f) => (
                    <label key={f.key} className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        data-buyer-email={f.key}
                        aria-label={f.label}
                        className="mt-0.5"
                        checked={settings[f.key]}
                        onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.checked }))}
                      />
                      <span>
                        {f.label}
                        <span className="block text-[11px] text-[var(--text-faint)]">{f.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <label className="mt-4 flex flex-col gap-1 text-xs md:w-1/2">
                  <span className="text-[var(--text-secondary)]">Replies go to (blank = the quote&apos;s sales rep, else your page email)</span>
                  <input
                    type="email"
                    maxLength={200}
                    placeholder="e.g. sales@yourshop.com"
                    aria-label="Reply-to email"
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                    value={settings.reply_to_email}
                    onChange={(e) => setSettings((s) => ({ ...s, reply_to_email: e.target.value }))}
                  />
                </label>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Emails go to the quote&apos;s buyer email, show your shop name and link to the quote. Staff can
                  untick &quot;Email the buyer&quot; when confirming, and send &quot;please re-approve&quot; from the
                  quote page when a price changes. Every email is listed on the quote page.
                </p>
              </div>

              {/* Step 29B: reminders */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4" data-reminders>
                <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Reminders</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2 text-xs">
                    <label className="flex items-center gap-2 text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        data-reminder="reminder_expiring_on"
                        aria-label="Buyer: quote expires soon"
                        checked={settings.reminder_expiring_on}
                        onChange={(e) => setSettings((s) => ({ ...s, reminder_expiring_on: e.target.checked }))}
                      />
                      Buyer: &quot;your quote expires soon&quot;
                    </label>
                    <label className="flex items-center gap-2 text-[var(--text-secondary)]">
                      <input
                        type="number"
                        min="1"
                        max="60"
                        step="1"
                        aria-label="Days before expiry"
                        className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                        value={settings.reminder_expiring_days}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, reminder_expiring_days: Math.round(Number(e.target.value) || 0) }))
                        }
                      />
                      days before it expires
                    </label>
                  </div>
                  <div className="flex flex-col gap-2 text-xs">
                    <label className="flex items-center gap-2 text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        data-reminder="reminder_followup_on"
                        aria-label="Buyer: follow-up"
                        checked={settings.reminder_followup_on}
                        onChange={(e) => setSettings((s) => ({ ...s, reminder_followup_on: e.target.checked }))}
                      />
                      Buyer: &quot;any questions?&quot; follow-up
                    </label>
                    <label className="flex items-center gap-2 text-[var(--text-secondary)]">
                      <input
                        type="number"
                        min="1"
                        max="60"
                        step="1"
                        aria-label="Days after the quote email"
                        className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                        value={settings.reminder_followup_days}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, reminder_followup_days: Math.round(Number(e.target.value) || 0) }))
                        }
                      />
                      days after the quote email, if not accepted
                    </label>
                  </div>
                  <div className="flex flex-col gap-2 text-xs">
                    <label className="flex items-center gap-2 text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        data-reminder="staff_digest_on"
                        aria-label="Staff daily digest"
                        checked={settings.staff_digest_on}
                        onChange={(e) => setSettings((s) => ({ ...s, staff_digest_on: e.target.checked }))}
                      />
                      Staff: daily digest (to confirm, new, expiring)
                    </label>
                    <label className="flex items-center gap-2 text-[var(--text-secondary)]">
                      at
                      <select
                        aria-label="Digest hour"
                        className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                        value={settings.staff_digest_hour}
                        onChange={(e) => setSettings((s) => ({ ...s, staff_digest_hour: Number(e.target.value) }))}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {`${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Time zone"
                        className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                        value={settings.shop_timezone}
                        onChange={(e) => setSettings((s) => ({ ...s, shop_timezone: e.target.value }))}
                      >
                        {(TIME_ZONES.includes(settings.shop_timezone) ? TIME_ZONES : [settings.shop_timezone, ...TIME_ZONES]).map(
                          (z) => (
                            <option key={z} value={z}>
                              {z.replace("_", " ")}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[var(--text-secondary)]">Digest goes to (blank = every admin user)</span>
                    <input
                      type="email"
                      maxLength={200}
                      placeholder="e.g. sales@yourshop.com"
                      aria-label="Digest email"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                      value={settings.staff_digest_to}
                      onChange={(e) => setSettings((s) => ({ ...s, staff_digest_to: e.target.value }))}
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Checked every hour. Buyer reminders only go to quotes Alex-IO emailed to the buyer, at most once per
                  quote email (and once per expiry date), never after the buyer accepts. The digest is skipped on days
                  with nothing to report. Every buyer reminder is listed on the quote page.
                </p>
              </div>

              </>
              ) : null}

              {/* Step 30: freight */}
              {section === "freight" ? (
                <FreightSettingsEditor value={settings.freight} onChange={(f) => setSettings((s) => ({ ...s, freight: f }))} />
              ) : null}

              {/* Save button */}
              <div className="mt-1 flex items-center justify-end gap-3">
                {savedMsg && !saving ? (
                  <span className="text-[11px] text-[var(--status-success-text)]" data-settings-saved>
                    {savedMsg}
                  </span>
                ) : null}
                <button
                  onClick={save}
                  disabled={saving || !loadedOk}
                  className="rounded-md bg-[var(--action-primary)] px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : copy.save}
                </button>
              </div>
            </div>
          )}
        </section>

        {after ? <div className="mt-6">{after}</div> : null}
      </div>
    </main>
  );
}
