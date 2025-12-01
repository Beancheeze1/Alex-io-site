// app/admin/materials/page.tsx
//
// Admin material editor + density / min-charge control.
//
// Path A safe:
//  - Uses /api/admin/materials for reads and updates.
//  - Only edits DB config fields (density_lb_ft3, min_charge_usd,
//    price_per_cuin, is_active).
//  - Does NOT touch pricing engine or foam advisor logic.

"use client";

import * as React from "react";
import Link from "next/link";

type Material = {
  id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  min_charge_usd: number | null;
  price_per_cuin: number | null;
  is_active: boolean;
};

type MaterialsResponse = {
  ok: boolean;
  materials: Material[];
};

type UpdateResponse = {
  ok: boolean;
  material?: Material;
  error?: string;
  message?: string;
};

function formatMoney(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toFixed(2);
}

function formatDensity(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toFixed(2);
}

export default function AdminMaterialsPage() {
  const [materials, setMaterials] = React.useState<Material[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedId, setSelectedId] = React.useState<number | null>(
    null,
  );
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] =
    React.useState<string | null>(null);

  const [draftDensity, setDraftDensity] = React.useState<string>("");
  const [draftMinCharge, setDraftMinCharge] = React.useState<string>("");
  const [draftPricePerCiuin, setDraftPricePerCiuin] =
    React.useState<string>("");
  const [draftIsActive, setDraftIsActive] =
    React.useState<boolean>(true);

  const selected = React.useMemo(
    () => materials.find((m) => m.id === selectedId) || null,
    [materials, selectedId],
  );

  React.useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/admin/materials", {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json: MaterialsResponse = await res.json();
        if (!active) return;

        if (!json.ok) {
          throw new Error("API returned ok=false");
        }

        setMaterials(json.materials || []);
      } catch (err: any) {
        console.error("Admin materials load error:", err);
        if (!active) return;
        setError(
          String(err?.message || "Unable to load materials list."),
        );
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

  // When selected material changes, reset draft fields
  React.useEffect(() => {
    if (!selected) {
      setDraftDensity("");
      setDraftMinCharge("");
      setDraftPricePerCiuin("");
      setDraftIsActive(true);
      setSaveError(null);
      setSaveSuccess(null);
      return;
    }

    setDraftDensity(formatDensity(selected.density_lb_ft3));
    setDraftMinCharge(formatMoney(selected.min_charge_usd));
    setDraftPricePerCiuin(formatMoney(selected.price_per_cuin));
    setDraftIsActive(selected.is_active);
    setSaveError(null);
    setSaveSuccess(null);
  }, [selected]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    const payload: Record<string, any> = {
      id: selected.id,
      is_active: draftIsActive,
    };

    // Only send numeric fields if user has typed something; blank = null.
    payload.density_lb_ft3 =
      draftDensity.trim() === ""
        ? null
        : Number(draftDensity.trim());
    payload.min_charge_usd =
      draftMinCharge.trim() === ""
        ? null
        : Number(draftMinCharge.trim());
    payload.price_per_cuin =
      draftPricePerCiuin.trim() === ""
        ? null
        : Number(draftPricePerCiuin.trim());

    try {
      const res = await fetch("/api/admin/materials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json: UpdateResponse = await res.json();

      if (!res.ok || !json.ok || !json.material) {
        const msg =
          json.message ||
          json.error ||
          `Update failed (HTTP ${res.status}).`;
        throw new Error(msg);
      }

      // Patch into local list
      setMaterials((prev) =>
        prev.map((m) =>
          m.id === json.material!.id ? json.material! : m,
        ),
      );

      setSaveSuccess("Material updated.");
    } catch (err: any) {
      console.error("Admin materials save error:", err);
      setSaveError(String(err?.message || "Unable to save changes."));
    } finally {
      setSaving(false);
    }
  }

  const hasMaterials = materials.length > 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Materials
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Admin view for foam and packaging materials. Adjust densities,
              min charges, and price-per-cubic-inch values that feed the
              quoting engine. No changes are visible to customers directly.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Left: materials list */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Materials
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Live list of materials with key pricing fields. Select a row
                  to edit density, min charge, and price-per-cubic-inch.
                </p>
              </div>
              <div className="text-[11px] text-slate-500">
                Future: filters by family, active status, and search.
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Family</th>
                    <th className="px-3 py-2 font-semibold">Density</th>
                    <th className="px-3 py-2 font-semibold">Min charge</th>
                    <th className="px-3 py-2 font-semibold">
                      Price / in³
                    </th>
                    <th className="px-3 py-2 font-semibold text-right">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !error && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-center text-xs text-slate-400"
                      >
                        Loading materials…
                      </td>
                    </tr>
                  )}

                  {!loading && error && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-center text-xs text-rose-300"
                      >
                        Unable to load materials.
                      </td>
                    </tr>
                  )}

                  {!loading && !error && !hasMaterials && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-center text-xs text-slate-400"
                      >
                        No materials found.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    !error &&
                    hasMaterials &&
                    materials.map((m) => {
                      const isSelected = m.id === selectedId;
                      return (
                        <tr
                          key={m.id}
                          className={`border-t border-slate-800/60 hover:bg-slate-900/70 cursor-pointer ${
                            isSelected ? "bg-slate-900/80" : ""
                          }`}
                          onClick={() =>
                            setSelectedId(
                              isSelected ? null : m.id,
                            )
                          }
                        >
                          <td className="px-3 py-2 text-xs text-slate-100">
                            {m.name}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {m.material_family || (
                              <span className="text-slate-500">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {m.density_lb_ft3 != null ? (
                              <span>
                                {m.density_lb_ft3.toFixed(2)} pcf
                              </span>
                            ) : (
                              <span className="text-slate-500">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {m.min_charge_usd != null ? (
                              <span>
                                ${m.min_charge_usd.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-500">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {m.price_per_cuin != null ? (
                              <span>
                                ${m.price_per_cuin.toFixed(4)}
                              </span>
                            ) : (
                              <span className="text-slate-500">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                                m.is_active
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                                  : "bg-slate-500/20 text-slate-200 border border-slate-500/40"
                              }`}
                            >
                              {m.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Polyethylene and Expanded Polyethylene remain separate families
              here; no normalization is done in code. All changes are via the
              <span className="font-mono text-sky-300">
                {" "}
                materials
              </span>{" "}
              table only.
            </p>
          </div>

          {/* Right: editor panel */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Edit material
            </div>

            {!selected && (
              <p className="text-xs text-slate-300">
                Select a material from the table to edit its density, min
                charge, and price-per-cubic-inch.
              </p>
            )}

            {selected && (
              <form
                onSubmit={handleSave}
                className="mt-2 space-y-3 text-xs text-slate-200"
              >
                <div>
                  <div className="text-[11px] font-semibold text-slate-100">
                    {selected.name}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Family:{" "}
                    {selected.material_family || (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Density (pcf)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-400"
                      value={draftDensity}
                      onChange={(e) =>
                        setDraftDensity(e.target.value)
                      }
                    />
                    <span className="text-[10px] text-slate-500">
                      Leave blank to store as null (density not set).
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Min charge (USD)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-400"
                      value={draftMinCharge}
                      onChange={(e) =>
                        setDraftMinCharge(e.target.value)
                      }
                    />
                    <span className="text-[10px] text-slate-500">
                      Leave blank to store as null (no material-level min
                      charge).
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Price per cubic inch (USD)
                    </span>
                    <input
                      type="number"
                      step="0.0001"
                      className="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-400"
                      value={draftPricePerCiuin}
                      onChange={(e) =>
                        setDraftPricePerCiuin(e.target.value)
                      }
                    />
                    <span className="text-[10px] text-slate-500">
                      Leave blank to store as null and let central price books
                      drive pricing.
                    </span>
                  </label>

                  <label className="mt-1 inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3 w-3 rounded border border-slate-700 bg-slate-950"
                      checked={draftIsActive}
                      onChange={(e) =>
                        setDraftIsActive(e.target.checked)
                      }
                    />
                    <span className="text-[11px] text-slate-300">
                      Active (eligible for quoting)
                    </span>
                  </label>
                </div>

                {saveError && (
                  <div className="rounded-md border border-rose-500/40 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-200">
                    {saveError}
                  </div>
                )}

                {saveSuccess && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-200">
                    {saveSuccess}
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center rounded-md border border-sky-500/60 bg-sky-600/90 px-3 py-1.5 text-xs font-semibold text-slate-50 shadow-sm hover:bg-sky-500 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>

                <p className="mt-3 text-[11px] text-slate-500">
                  These changes update the{" "}
                  <span className="font-mono text-sky-300">
                    materials
                  </span>{" "}
                  table directly and feed into existing pricing logic. No
                  changes are made to foam advisor or cavity parsing code.
                </p>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
