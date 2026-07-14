// app/admin/materials/page.tsx
//
// Materials admin landing page.
// Path A / Straight Path:
//  - Client-only.
//  - Primarily read-only, but now supports safe inline edits
//    of price_per_cuin and min_charge_usd via /api/admin/materials (PATCH).
//  - Does NOT change any pricing math; only updates DB inputs.
//
// Shows:
//  - Summary counts (total / active / by family).
//  - Table of materials with family, density, SKU, and basic pricing info.

"use client";

import * as React from "react";
import Link from "next/link";

type MaterialRow = {
  id: number;
  name: string;
  material_family: string | null;
  category: string | null;
  subcategory: string | null;
  sku: string | null;
  density_lb_ft3: number | string | null;
  cost_per_ci_usd: number | string | null;
  price_per_cuin: number | string | null;
  min_charge_usd: number | string | null;
  is_active: boolean;
};

type MaterialsResponse = {
  ok: boolean;
  materials: MaterialRow[];
  stats: {
    total: number;
    active: number;
    inactive: number;
    families: { family: string; count: number }[];
  };
};

function formatNumber(
  value: number | string | null | undefined,
  decimals: number,
): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return null;
  return n.toFixed(decimals);
}

function toEditableString(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toString();
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  return n.toString();
}

export default function AdminMaterialsPage() {
  const [materials, setMaterials] = React.useState<MaterialRow[]>([]);
  const [stats, setStats] = React.useState<
    MaterialsResponse["stats"] | null
  >(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = React.useState<string>("all");
  const [showInactive, setShowInactive] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // Inline edit state (price & minimum)
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editPrice, setEditPrice] = React.useState<string>("");
  const [editMinCharge, setEditMinCharge] = React.useState<string>("");
  const [savingId, setSavingId] = React.useState<number | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

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
        setMaterials(
          (json.materials || []).map((m) => ({
            ...m,
            is_active: (m as any).is_active ?? true,
          })),
        );
        setStats(json.stats || null);
      } catch (err: any) {
        console.error("Admin materials load error:", err);
        if (!active) return;
        setError(String(err?.message || "Unable to load materials."));
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

  const families = React.useMemo(() => {
    if (!stats) return [];
    return stats.families;
  }, [stats]);

  const filteredMaterials = React.useMemo(() => {
    let list = materials;

    if (!showInactive) {
      list = list.filter((m) => m.is_active);
    }

    if (familyFilter !== "all") {
      list = list.filter(
        (m) => (m.material_family || "Unspecified") === familyFilter,
      );
    }

    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter((m) => {
        const hay = `${m.name} ${m.sku || ""} ${
          m.material_family || ""
        } ${m.category || ""} ${m.subcategory || ""}`.toLowerCase();
        return hay.includes(s);
      });
    }

    return list;
  }, [materials, showInactive, familyFilter, search]);

  const hasData = filteredMaterials.length > 0;

  function beginEdit(row: MaterialRow) {
    setEditingId(row.id);
    setEditPrice(toEditableString(row.price_per_cuin));
    setEditMinCharge(toEditableString(row.min_charge_usd));
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditPrice("");
    setEditMinCharge("");
    setSavingId(null);
    setSaveError(null);
  }

  async function saveRow(row: MaterialRow) {
    if (savingId) return;
    setSaveError(null);

    const trimmedPrice = editPrice.trim();
    const trimmedMin = editMinCharge.trim();

    let priceValue: number | null = null;
    let minValue: number | null = null;

    if (trimmedPrice !== "") {
      const n = Number(trimmedPrice);
      if (!Number.isFinite(n) || n < 0) {
        setSaveError("Price per cu in must be a non-negative number.");
        return;
      }
      priceValue = n;
    }

    if (trimmedMin !== "") {
      const n = Number(trimmedMin);
      if (!Number.isFinite(n) || n < 0) {
        setSaveError("Min charge must be a non-negative number.");
        return;
      }
      minValue = n;
    }

    // If both are blank and match existing blanks, nothing to do.
    if (
      priceValue === null &&
      minValue === null &&
      (row.price_per_cuin === null || row.price_per_cuin === "") &&
      (row.min_charge_usd === null || row.min_charge_usd === "")
    ) {
      cancelEdit();
      return;
    }

    try {
      setSavingId(row.id);

      const res = await fetch("/api/admin/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          price_per_cuin: priceValue,
          min_charge_usd: minValue,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(
          json?.message ||
            json?.error ||
            `HTTP ${res.status} saving material`,
        );
      }

      const updated = json.material as MaterialRow | undefined;
      if (updated) {
        setMaterials((prev) =>
          prev.map((m) => (m.id === row.id ? { ...m, ...updated } : m)),
        );
      }

      cancelEdit();
    } catch (err: any) {
      console.error("Admin materials save error:", err);
      setSaveError(
        String(err?.message || "Unable to save material changes."),
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Materials (admin)
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              View and adjust the material records that drive quoting and the
              foam advisor. Families, densities, and baseline pricing all live
              here as your source of truth.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Coverage summary */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Material coverage
            </div>

            {loading && !error && (
              <p className="text-xs text-[var(--text-secondary)]">
                Loading materials…
              </p>
            )}

            {error && (
              <p className="text-xs text-[var(--attention)]">
                Error loading materials:{" "}
                <span className="font-mono text-[11px]">{error}</span>
              </p>
            )}

            {!loading && !error && stats && (
              <>
                <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.total}
                    </span>{" "}
                    total materials in the system.
                  </li>
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.active}
                    </span>{" "}
                    active;{" "}
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.inactive}
                    </span>{" "}
                    inactive.
                  </li>
                  <li>
                    {stats.families.length} material families configured.
                  </li>
                </ul>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Polyethylene and Expanded Polyethylene remain separate
                  families here; we never normalize or merge them in code. The{" "}
                  <span className="font-mono text-[var(--text-secondary)]">
                    material_family
                  </span>{" "}
                  column in the database is the source of truth.
                </p>
              </>
            )}

            {!loading && !error && !stats && (
              <p className="text-xs text-[var(--text-secondary)]">
                No material stats available yet.
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Material notes
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              This view now supports safe inline edits of base pricing:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-[var(--text-secondary)]">
              <li>Update price-per-cubic-inch and minimum charges in place.</li>
              <li>
                All changes flow into the existing pricing engine without
                touching any math.
              </li>
              <li>Future: flags, links to cushion curves, and more.</li>
            </ul>
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Use this area for admin-only pricing inputs. Customers never see
              this page.
            </p>
          </div>
        </section>

        {/* Filters + table */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--text-secondary)]">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Materials
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Live view backed by the database. Use filters to focus by family
                or search by name / SKU. Click Edit on a row to adjust pricing.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-secondary)]">
              <select
                value={familyFilter}
                onChange={(e) => setFamilyFilter(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
              >
                <option value="all">All families</option>
                {families.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family} ({f.count})
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-[var(--border-strong)] bg-[var(--surface-card)] text-[var(--action-primary)]"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                <span>Show inactive</span>
              </label>

              <input
                type="text"
                placeholder="Search name / SKU / family"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
              />
            </div>
          </div>

          {saveError && (
            <div className="mb-3 rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-[11px] text-[var(--attention)]">
              {saveError}
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-card)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Family</th>
                  <th className="px-3 py-2 font-medium">Density</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Price/cu in</th>
                  <th className="px-3 py-2 font-medium">Min charge</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && !error && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                    >
                      Loading materials…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-4 text-center text-xs text-[var(--attention)]"
                    >
                      Unable to load materials.
                    </td>
                  </tr>
                )}

                {!loading && !error && !hasData && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                    >
                      No materials match the current filters.
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  hasData &&
                  filteredMaterials.map((m) => {
                    const density = formatNumber(
                      m.density_lb_ft3,
                      2,
                    );
                    const pricePerCuIn = formatNumber(
                      m.price_per_cuin,
                      4,
                    );
                    const minCharge = formatNumber(
                      m.min_charge_usd,
                      2,
                    );

                    const isEditing = editingId === m.id;
                    const rowSaving = savingId === m.id;

                    return (
                      <tr
                        key={m.id}
                        className="border-t border-[var(--border)] hover:bg-[var(--surface-subtle)]"
                      >
                        <td className="px-3 py-2 text-xs text-[var(--text-primary)]">
                          {m.name}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {m.material_family || (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {density ? (
                            <span>{density} pcf</span>
                          ) : (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {m.sku || (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.0001"
                              className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-1 py-0.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                              value={editPrice}
                              onChange={(e) =>
                                setEditPrice(e.target.value)
                              }
                            />
                          ) : pricePerCuIn ? (
                            <span>${pricePerCuIn}</span>
                          ) : (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-1 py-0.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]"
                              value={editMinCharge}
                              onChange={(e) =>
                                setEditMinCharge(e.target.value)
                              }
                            />
                          ) : minCharge ? (
                            <span>${minCharge}</span>
                          ) : (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] border ${
                              m.is_active
                                ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-text)]/40"
                                : "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border-[var(--border)]"
                            }`}
                          >
                            {m.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-[11px]">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                disabled={rowSaving}
                                onClick={() => saveRow(m)}
                                className="rounded-full bg-[var(--action-primary)] px-3 py-0.5 font-medium text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-60"
                              >
                                {rowSaving ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={rowSaving}
                                onClick={cancelEdit}
                                className="rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-0.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] disabled:opacity-60"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => beginEdit(m)}
                              className="rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-0.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-[var(--text-faint)]">
            Changes made here update the{" "}
            <span className="font-mono text-[var(--text-secondary)]">materials</span> table and
            flow into the pricing engine as inputs. The underlying math and
            quoting logic remain unchanged.
          </p>
        </section>
      </div>
    </main>
  );
}
