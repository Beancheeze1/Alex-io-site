// app/admin/boxes/page.tsx
//
// Admin Carton Pricing Editor
// Path A safe: edits only carton pricing + tiers via /api/admin/boxes.
// - Shows all active boxes with base unit price + up to 4 tiers.
// - Allows blank (NULL) prices and blank min-qty for any tier.
// - 2-decimal prices enforced by DB (numeric(12,2)).
//
// Does NOT touch:
// - Foam pricing formulas
// - quote_items / quote_box_selections logic
// - Layout behavior

"use client";

import * as React from "react";

type BoxApiRow = {
  box_id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: string | number;
  inside_width_in: string | number;
  inside_height_in: string | number;

  tier_id: number | null;
  base_unit_price: string | number | null;
  tier1_min_qty: number | null;
  tier1_unit_price: string | number | null;
  tier2_min_qty: number | null;
  tier2_unit_price: string | number | null;
  tier3_min_qty: number | null;
  tier3_unit_price: string | number | null;
  tier4_min_qty: number | null;
  tier4_unit_price: string | number | null;
};

type ApiOk = {
  ok: true;
  boxes: BoxApiRow[];
};

type ApiErr = {
  ok: false;
  error: string;
  message?: string;
};

type ApiResponse = ApiOk | ApiErr;

type AdminBoxRow = {
  box_id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_dims: string;

  tier_id: number | null;
  base_unit_price: string;
  tier1_min_qty: string;
  tier1_unit_price: string;
  tier2_min_qty: string;
  tier2_unit_price: string;
  tier3_min_qty: string;
  tier3_unit_price: string;
  tier4_min_qty: string;
  tier4_unit_price: string;
};

function formatDims(l: any, w: any, h: any): string {
  const parts = [l, w, h].map((raw) => {
    if (raw === null || raw === undefined) return "";
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return String(raw ?? "");
    const rounded = Math.round(n * 100) / 100;
    return rounded
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
  });
  return parts.join(" x ");
}

function normalizeStr(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

export default function AdminBoxesPage() {
  const [rows, setRows] = React.useState<AdminBoxRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setSaveMessage(null);

        const res = await fetch("/api/admin/boxes", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;

        if (!active) return;

        if (!res.ok || !json.ok) {
          const msg =
            (!json.ok && (json as ApiErr).message) ||
            (!json.ok && (json as ApiErr).error) ||
            "Failed to load carton pricing.";
          setError(msg);
          setRows([]);
          return;
        }

        const okJson = json as ApiOk;
        const mapped: AdminBoxRow[] = okJson.boxes.map((b) => {
          const inside_dims = formatDims(
            b.inside_length_in,
            b.inside_width_in,
            b.inside_height_in,
          );

          return {
            box_id: b.box_id,
            vendor: b.vendor,
            style: b.style,
            sku: b.sku,
            description: b.description,
            inside_dims,

            tier_id: b.tier_id ?? null,
            base_unit_price: normalizeStr(b.base_unit_price),
            tier1_min_qty: b.tier1_min_qty != null ? String(b.tier1_min_qty) : "",
            tier1_unit_price: normalizeStr(b.tier1_unit_price),
            tier2_min_qty: b.tier2_min_qty != null ? String(b.tier2_min_qty) : "",
            tier2_unit_price: normalizeStr(b.tier2_unit_price),
            tier3_min_qty: b.tier3_min_qty != null ? String(b.tier3_min_qty) : "",
            tier3_unit_price: normalizeStr(b.tier3_unit_price),
            tier4_min_qty: b.tier4_min_qty != null ? String(b.tier4_min_qty) : "",
            tier4_unit_price: normalizeStr(b.tier4_unit_price),
          };
        });

        setRows(mapped);
      } catch (err) {
        console.error("Error loading /api/admin/boxes:", err);
        if (!active) return;
        setError(
          "There was an unexpected problem loading carton pricing. Please try again.",
        );
        setRows([]);
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

  function updateRow(
    boxId: number,
    field:
      | "base_unit_price"
      | "tier1_min_qty"
      | "tier1_unit_price"
      | "tier2_min_qty"
      | "tier2_unit_price"
      | "tier3_min_qty"
      | "tier3_unit_price"
      | "tier4_min_qty"
      | "tier4_unit_price",
    value: string,
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.box_id === boxId
          ? {
              ...r,
              [field]: value,
            }
          : r,
      ),
    );
  }

  async function handleSaveAll() {
    if (!rows.length) return;

    try {
      setSaving(true);
      setSaveMessage(null);
      setError(null);

      const payload = {
        updates: rows.map((r) => ({
          box_id: r.box_id,
          tier_id: r.tier_id,
          base_unit_price: r.base_unit_price,
          tier1_min_qty: r.tier1_min_qty,
          tier1_unit_price: r.tier1_unit_price,
          tier2_min_qty: r.tier2_min_qty,
          tier2_unit_price: r.tier2_unit_price,
          tier3_min_qty: r.tier3_min_qty,
          tier3_unit_price: r.tier3_unit_price,
          tier4_min_qty: r.tier4_min_qty,
          tier4_unit_price: r.tier4_unit_price,
        })),
      };

      const res = await fetch("/api/admin/boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; applied?: number; message?: string; error?: string }
        | null;

      if (!res.ok || !json || !json.ok) {
        const msg =
          (json && (json.message || json.error)) ||
          "Failed to save carton pricing.";
        setError(msg);
        setSaveMessage(null);
        return;
      }

      const applied = json.applied ?? 0;
      setSaveMessage(
        applied > 0
          ? `Saved pricing for ${applied} carton record${applied === 1 ? "" : "s"}.`
          : "Save completed (no changes detected).",
      );
    } catch (err) {
      console.error("Error saving carton pricing:", err);
      setError(
        "There was an unexpected problem saving carton pricing. Please try again.",
      );
      setSaveMessage(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-4 border-b border-slate-800 pb-4">
          <h1 className="text-2xl font-semibold text-sky-300">
            Carton pricing (RSC & mailers)
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            Internal pricing controls for carton add-ons. Changes here affect
            packaging pricing when cartons are attached to quotes.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Prices are stored as per-carton amounts with{" "}
            <span className="font-semibold text-sky-300">2 decimal places</span>{" "}
            in the database. Leave fields blank to treat them as{" "}
            <span className="font-semibold text-sky-300">NULL</span> (no tier
            price).
          </p>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {loading
              ? "Loading carton catalog…"
              : rows.length === 0
              ? "No active cartons found."
              : `Showing ${rows.length} active carton SKU${
                  rows.length === 1 ? "" : "s"
                }.`}
          </div>
          <div className="flex items-center gap-3">
            {saveMessage && (
              <div className="text-[11px] text-emerald-300">{saveMessage}</div>
            )}
            {error && (
              <div className="text-[11px] text-rose-300 max-w-xs text-right">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving || loading || rows.length === 0}
              className="inline-flex items-center rounded-full border border-sky-500/60 bg-sky-600/20 px-4 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save all changes"}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-900/90">
              <tr>
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Vendor / SKU
                </th>
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Description
                </th>
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Inside dims (L x W x H in)
                </th>
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Base unit price
                  <div className="text-[10px] font-normal text-slate-500">
                    Default per carton
                  </div>
                </th>
                {/* Tier 1 */}
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Tier 1
                  <div className="text-[10px] font-normal text-slate-500">
                    Min qty / unit price
                  </div>
                </th>
                {/* Tier 2 */}
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Tier 2
                  <div className="text-[10px] font-normal text-slate-500">
                    Min qty / unit price
                  </div>
                </th>
                {/* Tier 3 */}
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Tier 3
                  <div className="text-[10px] font-normal text-slate-500">
                    Min qty / unit price
                  </div>
                </th>
                {/* Tier 4 (future) */}
                <th className="border-b border-slate-800 px-3 py-2 text-left font-medium text-slate-300">
                  Tier 4 (future)
                  <div className="text-[10px] font-normal text-slate-500">
                    Min qty / unit price
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-4 text-center text-xs text-slate-500"
                  >
                    No active cartons found.
                  </td>
                </tr>
              )}

              {rows.map((row, idx) => {
                const prevVendor =
                  idx > 0 ? rows[idx - 1].vendor : undefined;
                const showVendorBadge = row.vendor !== prevVendor;

                return (
                  <tr
                    key={row.box_id}
                    className="border-t border-slate-800/70 hover:bg-slate-900/80"
                  >
                    {/* Vendor / SKU */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {showVendorBadge && (
                            <span className="inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-200">
                              {row.vendor}
                            </span>
                          )}
                          {!showVendorBadge && (
                            <span className="inline-flex w-3 border-t border-slate-700" />
                          )}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-100">
                          {row.sku}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {row.style}
                        </div>
                      </div>
                    </td>

                    {/* Description */}
                    <td className="px-3 py-2 align-top">
                      <div className="max-w-xs text-[11px] text-slate-200">
                        {row.description}
                      </div>
                    </td>

                    {/* Inside dims */}
                    <td className="px-3 py-2 align-top">
                      <div className="text-[11px] text-slate-100">
                        {row.inside_dims}
                      </div>
                    </td>

                    {/* Base unit price */}
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                        value={row.base_unit_price}
                        onChange={(e) =>
                          updateRow(
                            row.box_id,
                            "base_unit_price",
                            e.target.value,
                          )
                        }
                        placeholder="e.g. 1.25"
                      />
                      <div className="mt-1 text-[10px] text-slate-500">
                        Leave blank to use tier pricing only.
                      </div>
                    </td>

                    {/* Tier 1 */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          step="1"
                          inputMode="numeric"
                          className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier1_min_qty}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier1_min_qty",
                              e.target.value,
                            )
                          }
                          placeholder="Min qty"
                        />
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier1_unit_price}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier1_unit_price",
                              e.target.value,
                            )
                          }
                          placeholder="Unit price"
                        />
                      </div>
                    </td>

                    {/* Tier 2 */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          step="1"
                          inputMode="numeric"
                          className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier2_min_qty}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier2_min_qty",
                              e.target.value,
                            )
                          }
                          placeholder="Min qty"
                        />
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier2_unit_price}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier2_unit_price",
                              e.target.value,
                            )
                          }
                          placeholder="Unit price"
                        />
                      </div>
                    </td>

                    {/* Tier 3 */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          step="1"
                          inputMode="numeric"
                          className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier3_min_qty}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier3_min_qty",
                              e.target.value,
                            )
                          }
                          placeholder="Min qty"
                        />
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier3_unit_price}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier3_unit_price",
                              e.target.value,
                            )
                          }
                          placeholder="Unit price"
                        />
                      </div>
                    </td>

                    {/* Tier 4 */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          step="1"
                          inputMode="numeric"
                          className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier4_min_qty}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier4_min_qty",
                              e.target.value,
                            )
                          }
                          placeholder="Min qty"
                        />
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          value={row.tier4_unit_price}
                          onChange={(e) =>
                            updateRow(
                              row.box_id,
                              "tier4_unit_price",
                              e.target.value,
                            )
                          }
                          placeholder="Unit price"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[11px] text-slate-500">
          Admin only – changes here are for internal pricing control and are not
          visible on the customer quote page except as updated packaging prices.
        </p>
      </div>
    </main>
  );
}
