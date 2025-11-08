"use client";

import { useEffect, useState } from "react";

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
        setSettings({
          skive_upcharge_each: numberOr(json.skive_upcharge_each, 0),
          ratePerCI_default: numberOr(json.ratePerCI_default, 0),
          ratePerBF_default: numberOr(json.ratePerBF_default, 0),
          kerf_pct_default: numberOr(json.kerf_pct_default, 0),
          min_charge_default: numberOr(json.min_charge_default, 0),
          cushion_family_order: Array.isArray(json.cushion_family_order) ? json.cushion_family_order : [],
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
      // Optional re-fetch
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
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Pricing Settings</h1>

      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-2xl shadow p-5 border">
            <h2 className="text-lg font-medium mb-3">Skiving & Defaults</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">Skive upcharge (per piece) — $</span>
                <input
                  type="number"
                  step="0.01"
                  className="border rounded px-3 py-2"
                  value={settings.skive_upcharge_each}
                  onChange={(e) => setNum("skive_upcharge_each")(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">Default rate ($ / cubic inch)</span>
                <input
                  type="number"
                  step="0.0001"
                  className="border rounded px-3 py-2"
                  value={settings.ratePerCI_default}
                  onChange={(e) => setNum("ratePerCI_default")(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">Default rate ($ / board foot)</span>
                <input
                  type="number"
                  step="0.01"
                  className="border rounded px-3 py-2"
                  value={settings.ratePerBF_default}
                  onChange={(e) => setNum("ratePerBF_default")(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">Default kerf waste (%)</span>
                <input
                  type="number"
                  step="1"
                  className="border rounded px-3 py-2"
                  value={settings.kerf_pct_default}
                  onChange={(e) => setNum("kerf_pct_default")(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">Default minimum charge ($)</span>
                <input
                  type="number"
                  step="0.01"
                  className="border rounded px-3 py-2"
                  value={settings.min_charge_default}
                  onChange={(e) => setNum("min_charge_default")(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-sm opacity-70">Cushion family priority (comma-separated)</span>
                <input
                  type="text"
                  className="border rounded px-3 py-2"
                  placeholder="PE, EPE, PU, EVA"
                  value={settings.cushion_family_order.join(", ")}
                  onChange={(e) => setArray("cushion_family_order")(e.target.value)}
                />
              </label>
            </div>

            {err && <div className="text-red-600 text-sm mt-3">{err}</div>}

            <div className="mt-4 flex gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-2xl px-4 py-2 border shadow hover:shadow-md transition"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="text-sm opacity-70">
            Tip: Non-1″ thicknesses automatically apply the “Skive upcharge per piece” when the
            price endpoint detects a non-integer inch thickness.
          </div>
        </div>
      )}
    </div>
  );
}
