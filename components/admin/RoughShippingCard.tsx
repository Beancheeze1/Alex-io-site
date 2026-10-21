// components/admin/RoughShippingCard.tsx
//
// Step 38C: the rough shipping % and cap (used only when freight isn't set
// up), moved from the admin Home to Pricing → Freight & shipping. Same
// /api/admin/shipping-settings GET/POST as before; only the location moved.

"use client";

import * as React from "react";

type ShippingSettingsResponse = {
  ok: boolean;
  rough_ship_pct: number;
  shipping_cap_usd?: number;
  source?: "db" | "default";
  error?: string;
  message?: string;
};

export default function RoughShippingCard() {
  const [value, setValue] = React.useState<string>("");
  const [capValue, setCapValue] = React.useState<string>("");
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
        const cap = json.shipping_cap_usd ?? 200.0;
        setValue(String(pct));
        setCapValue(String(cap));
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

    const capN = Number(capValue);
    if (!Number.isFinite(capN) || capN < 0) {
      setError("Please enter a valid shipping cap ($, 0 or more).");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/shipping-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rough_ship_pct: n, shipping_cap_usd: capN }),
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
        setSavedMessage("Saved – new rough shipping % and cap are live.");
        setError(null);
        const pct = json.rough_ship_pct ?? n;
        const cap = json.shipping_cap_usd ?? capN;
        setValue(String(pct));
        setCapValue(String(cap));
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Rough shipping %
        </div>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        Controls the <span className="font-medium">rough shipping estimate</span>{" "}
        as a percentage of the order subtotal. Used only when freight isn&apos;t set up (no ship-from ZIP).
      </p>

      {loading && (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Loading current setting…
        </p>
      )}

      {!loading && (
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-secondary)]">
              Rough shipping (% of the order)
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
              className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1 disabled:opacity-60"
            />
            <span className="text-xs text-[var(--text-muted)]">%</span>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-secondary)]">
              Shipping cap ($ max)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">$</span>
            <input
              type="number"
              step="1"
              min={0}
              value={capValue}
              onChange={(e) => setCapValue(e.target.value)}
              disabled={disabled}
              className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1 disabled:opacity-60"
            />
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            If the computed rough shipping estimate exceeds this amount, the cap is shown instead.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={disabled}
              className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save shipping settings"}
            </button>
            {savedMessage && (
              <span className="text-[11px] text-[var(--status-success-text)]">
                {savedMessage}
              </span>
            )}
          </div>

          {error && <p className="text-[11px] text-[var(--attention)]">{error}</p>}
        </form>
      )}
    </div>
  );
}
