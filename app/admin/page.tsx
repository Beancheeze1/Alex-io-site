// app/admin/page.tsx
//
// Admin home dashboard (navigation hub + health + global knobs).
// Path A / Straight Path safe.
// - System Health row uses /api/health/* endpoints.
// - HubSpot + Email (Graph) cards each have a "Run deep check" button.
// - Rough shipping % knob backed by /api/admin/shipping-settings.
//   (This only stores the setting; shipping math wiring is in the quote page.)

"use client";

import * as React from "react";
import Link from "next/link";

type HealthResponse = {
  ok: boolean;
  status: string;
  detail?: string;
  message?: string;
  latency_ms?: number;
  configured?: boolean;
  missing_env?: string[];
};

type ShippingSettingsResponse = {
  ok: boolean;
  rough_ship_pct: number;
  source?: "db" | "default";
  error?: string;
  message?: string;
};

function useHealth(endpoint: string) {
  const [data, setData] = React.useState<HealthResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as HealthResponse;
        if (!active) return;
        setData(json);
        setError(null);
      } catch (err) {
        console.error(`Health check failed for ${endpoint}:`, err);
        if (!active) return;
        setError("Health check failed.");
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
  }, [endpoint]);

  return { data, loading, error };
}

export default function AdminHomePage() {
  const dbHealth = useHealth("/api/health/db");
  const hubspotHealth = useHealth("/api/health/hubspot");
  const emailHealth = useHealth("/api/health/email");

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-8 border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-sky-300">
            Alex-IO Admin
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Internal tools for quotes, layouts, pricing &amp; foam data.
          </p>
        </header>

        {/* System health row */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            System Health
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Database card */}
            <HealthCard
              title="Database"
              description="Core Postgres connection used by quotes, materials, and layouts."
              state={dbHealth}
              flavor="db"
            />

            {/* HubSpot card (with deep check) */}
            <HealthCard
              title="HubSpot"
              description="Conversations & CRM integration driving inbound quote requests."
              state={hubspotHealth}
              flavor="hubspot"
            />

            {/* Email (Graph) card (with deep check) */}
            <HealthCard
              title="Email (Graph)"
              description="Outbound quote replies from the dedicated alex-io.com mailbox."
              state={emailHealth}
              flavor="email"
            />
          </div>
        </section>

        {/* Main navigation tiles */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Admin Areas
          </h2>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Materials & densities */}
            <NavCard
              href="/admin/materials"
              title="Materials & densities"
              description="Manage foam materials, families, densities, and active status used for quoting."
            />

            {/* Cushion curves */}
            <NavCard
              href="/admin/cushion-curves"
              title="Cushion curves"
              description="Review and maintain cushion curve data that powers the foam advisor and recommendations."
            />

            {/* Pricing / price books */}
            <NavCard
              href="/admin/pricing"
              title="Pricing & price books"
              description="View price books and run pricing sandbox tests without affecting real quotes."
            />

            {/* Carton pricing */}
            <NavCard
              href="/admin/boxes"
              title="Carton pricing (RSC & mailers)"
              description="Manage carton SKUs, placeholder pricing, and box price tiers used for packaging add-ons."
            />

            {/* Pricing settings & knobs */}
            <NavCard
              href="/admin/settings"
              title="Pricing settings & knobs"
              description="Tune machine rates, markup, skiving upcharge, and material-family preferences used by the engine."
            />

            {/* Quotes & layouts */}
            <NavCard
              href="/admin/quotes"
              title="Quotes & layouts"
              description="Engineering view of quotes, layouts, and CAD exports for internal review."
            />

            {/* Logs */}
            <NavCard
              href="/admin/logs"
              title="Logs & events"
              description="Inspect webhook events, error logs, and other system diagnostics."
            />
          </div>
        </section>

        {/* Rough shipping estimate knob - moved under Admin Areas */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Rough Shipping Estimate
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ShippingSettingsCard />
          </div>
        </section>
      </div>
    </main>
  );
}

type HealthCardProps = {
  title: string;
  description: string;
  flavor: "db" | "hubspot" | "email";
  state: {
    data: HealthResponse | null;
    loading: boolean;
    error: string | null;
  };
};

function HealthCard({ title, description, flavor, state }: HealthCardProps) {
  const { data, loading, error } = state;

  const [deepLoading, setDeepLoading] = React.useState(false);
  const [deepResult, setDeepResult] = React.useState<string | null>(null);
  const [deepError, setDeepError] = React.useState<string | null>(null);

  let statusLabel = "Unknown";
  let statusClass =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-slate-700/40 text-slate-200 border border-slate-600/60";
  let detailText = "Tests coming soon.";
  let extraLine: string | null = null;

  if (loading) {
    statusLabel = "Checking…";
    detailText = "Running health probe…";
  } else if (error) {
    statusLabel = "Down";
    statusClass =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/40";
    detailText = error;
  } else if (data) {
    if (flavor === "db") {
      if (data.ok && data.status === "up") {
        statusLabel = "Up";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
        detailText =
          data.detail ||
          "Database connection OK and basic query succeeded.";
        if (typeof data.latency_ms === "number") {
          extraLine = `Last check: ~${data.latency_ms} ms`;
        }
      } else {
        statusLabel = "Down";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/40";
        detailText =
          data.message || data.detail || "Database health check failed.";
      }
    } else {
      const configured = !!data.configured;
      if (configured) {
        statusLabel = "Configured";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
        detailText =
          data.detail ||
          "Required environment variables are present for this integration.";
      } else {
        statusLabel = "Not configured";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-200 border border-amber-500/40";
        detailText =
          data.detail ||
          "One or more required environment variables are missing.";
        if (data.missing_env && data.missing_env.length > 0) {
          extraLine = `Missing: ${data.missing_env.join(", ")}`;
        }
      }
    }
  }

  async function runDeepCheck() {
    // DB has no deep check button.
    if (flavor === "db") return;

    setDeepLoading(true);
    setDeepResult(null);
    setDeepError(null);

    const endpoint =
      flavor === "hubspot"
        ? "/api/health/hubspot/deep"
        : "/api/health/email/deep";

    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const json: any = await res.json().catch(() => null);

      if (res.ok && json && json.ok) {
        setDeepResult(
          json.detail ||
            "Deep check OK – integration responded successfully.",
        );
        setDeepError(null);
      } else {
        setDeepResult(null);
        setDeepError(
          (json && (json.message || json.error)) ||
            "Deep check failed. See logs for details.",
        );
      }
    } catch (err) {
      console.error(`Deep health check failed for ${flavor}:`, err);
      setDeepResult(null);
      setDeepError("Deep check failed due to an unexpected error.");
    } finally {
      setDeepLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          {title}
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div className="text-xs text-slate-200">{description}</div>
      <div className="mt-2 text-[11px] text-slate-400">{detailText}</div>
      {extraLine && (
        <div className="mt-1 text-[11px] text-slate-500">{extraLine}</div>
      )}

      {/* Deep check UI for HubSpot + Graph */}
      {(flavor === "hubspot" || flavor === "email") && (
        <div className="mt-3 border-t border-slate-800 pt-2">
          <button
            type="button"
            onClick={runDeepCheck}
            disabled={deepLoading}
            className="inline-flex items-center rounded-full border border-sky-500/60 bg-sky-600/20 px-3 py-1 text-[11px] font-medium text-sky-200 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deepLoading ? "Running deep check…" : "Run deep check"}
          </button>
          {deepResult && !deepError && (
            <p className="mt-2 text-[11px] text-emerald-300">{deepResult}</p>
          )}
          {deepError && (
            <p className="mt-2 text-[11px] text-rose-300">{deepError}</p>
          )}
        </div>
      )}
    </div>
  );
}

type NavCardProps = {
  href: string;
  title: string;
  description: string;
};

function NavCard({ href, title, description }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm transition hover:border-sky-400/70 hover:bg-slate-900"
    >
      <div className="mb-2 text-sm font-semibold text-slate-100 group-hover:text-sky-300">
        {title}
      </div>
      <p className="flex-1 text-xs text-slate-300">{description}</p>
      <div className="mt-3 text-[11px] text-slate-500">
        Admin only – not visible to customers.
      </div>
    </Link>
  );
}

// ---------- Shipping settings card ----------

function ShippingSettingsCard() {
  const [value, setValue] = React.useState<string>("");
  const [initialLoaded, setInitialLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch("/api/admin/shipping-settings", {
          cache: "no-store",
        });
        const json = (await res
          .json()
          .catch(() => null)) as ShippingSettingsResponse | null;

        if (!active) return;

        if (!res.ok || !json || !json.ok) {
          const msg =
            (json && (json.message || json.error)) ||
            "Failed to load shipping settings.";
          setError(msg);
          setLoading(false);
          return;
        }

        const pct = json.rough_ship_pct ?? 2.0;
        setValue(String(pct));
        setError(null);
        setInitialLoaded(true);
      } catch (err) {
        console.error("Failed to load shipping settings:", err);
        if (!active) return;
        setError("Failed to load shipping settings.");
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavedMessage(null);
    setError(null);

    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setError("Please enter a valid percentage (0–100).");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/shipping-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rough_ship_pct: n }),
      });

      const json = (await res
        .json()
        .catch(() => null)) as ShippingSettingsResponse | null;

      if (!res.ok || !json || !json.ok) {
        const msg =
          (json && (json.message || json.error)) ||
          "Failed to save shipping settings.";
        setError(msg);
        setSavedMessage(null);
      } else {
        setSavedMessage("Saved – new rough shipping % is live.");
        setError(null);
        const pct = json.rough_ship_pct ?? n;
        setValue(String(pct));
      }
    } catch (err) {
      console.error("Failed to save shipping settings:", err);
      setError("Failed to save shipping settings.");
      setSavedMessage(null);
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || !initialLoaded || saving;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          Rough shipping %
        </div>
        <span className="inline-flex items-center rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300">
          Global knob
        </span>
      </div>

      <p className="text-xs text-slate-200">
        Controls the <span className="font-semibold">rough shipping estimate</span>{" "}
        as a percentage of the combined{" "}
        <span className="font-mono">foam + packaging</span> subtotal. This is a
        quick, adjustable placeholder for freight until we wire in a full
        shipping engine.
      </p>

      {loading && (
        <p className="mt-3 text-[11px] text-slate-400">
          Loading current setting…
        </p>
      )}

      {!loading && (
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-300">
              Rough shipping (% of foam + packaging)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={disabled}
              className="w-28 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/40 focus:border-sky-400 focus:ring-1 disabled:opacity-60"
            />
            <span className="text-xs text-slate-400">%</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={disabled}
              className="inline-flex items-center rounded-full border border-sky-500/60 bg-sky-600/20 px-3 py-1 text-[11px] font-medium text-sky-200 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save rough shipping %"}
            </button>
            {savedMessage && (
              <span className="text-[11px] text-emerald-300">
                {savedMessage}
              </span>
            )}
          </div>

          {error && (
            <p className="text-[11px] text-rose-300">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
