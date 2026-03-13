"use client";
// app/admin/cleanup/page.tsx
//
// Data Cleanup admin page.
// Lets super-owner (and admins for their own tenant) safely delete test data.
// Three sections: Quotes, Users/Sales Reps, Tenants (super-owner only).
//
// Pattern:
//  1. Set filters
//  2. "Preview" → dry-run count call
//  3. Confirm modal with count → DELETE call

import * as React from "react";

// ── types ─────────────────────────────────────────────────────────────────────

type Tab = "quotes" | "users" | "tenants";

interface QuoteFilters {
  tenantId: string;
  status: string;
  before: string;
  after: string;
}

interface UserFilters {
  tenantId: string;
  role: string;
  before: string;
  after: string;
  hasNoQuotes: boolean;
}

interface TenantFilters {
  slug: string;
  active: string; // "all" | "true" | "false"
  before: string;
  after: string;
}

interface PreviewResult {
  count: number;
  quoteCount?: number;
  userCount?: number;
  tenantIds?: number[];
}

type ConfirmState = {
  tab: Tab;
  preview: PreviewResult;
} | null;

// ── helpers ───────────────────────────────────────────────────────────────────

function inputCls(extra = "") {
  return `bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500 w-full ${extra}`;
}

function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-neutral-500 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-neutral-800 rounded-lg p-5 space-y-4 bg-neutral-950">
      {children}
    </div>
  );
}

function StatusBadge({ children, color }: { children: React.ReactNode; color: "red" | "amber" | "emerald" | "neutral" }) {
  const cls = {
    red: "bg-red-500/10 border-red-500/30 text-red-300",
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    neutral: "bg-neutral-800 border-neutral-700 text-neutral-400",
  }[color];
  return (
    <div className={`border rounded px-3 py-2 text-xs ${cls}`}>{children}</div>
  );
}

// ── confirm modal ──────────────────────────────────────────────────────────────

function ConfirmModal({
  state,
  onCancel,
  onConfirm,
  busy,
}: {
  state: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  if (!state) return null;

  const { tab, preview } = state;
  const label = tab === "quotes" ? "quotes" : tab === "users" ? "users / sales reps" : "tenants";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <span className="text-red-400 text-sm">!</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-neutral-100">Confirm permanent deletion</div>
            <div className="text-xs text-neutral-400 mt-1">This action cannot be undone.</div>
          </div>
        </div>

        <div className="bg-neutral-800/60 border border-neutral-700 rounded-lg p-4 space-y-1.5">
          <div className="text-sm text-neutral-200">
            <span className="font-semibold text-red-300">{preview.count.toLocaleString()}</span>{" "}
            {label} will be permanently deleted.
          </div>
          {typeof preview.quoteCount === "number" && (
            <div className="text-xs text-neutral-400">
              Includes <span className="text-neutral-300">{preview.quoteCount.toLocaleString()}</span> quotes and{" "}
              <span className="text-neutral-300">{preview.userCount?.toLocaleString()}</span> users.
            </div>
          )}
          <div className="text-[11px] text-neutral-500 mt-1">
            {tab === "quotes" && "Locked (RFM) quotes are excluded from deletion."}
            {tab === "users" && "Users with locked quotes are excluded. Their quotes will have sales rep cleared."}
            {tab === "tenants" && "The 'default' tenant is always excluded. All tenant data will be cascaded."}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-sm rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-50"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting…" : `Delete ${preview.count.toLocaleString()} ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── quotes section ─────────────────────────────────────────────────────────────

function QuotesSection({
  isSuperOwner,
  tenants,
}: {
  isSuperOwner: boolean;
  tenants: { id: number; name: string; slug: string }[];
}) {
  const [filters, setFilters] = React.useState<QuoteFilters>({
    tenantId: "",
    status: "",
    before: "",
    after: "",
  });
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ deleted: number } | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  function patch(k: keyof QuoteFilters, v: any) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPreview(null);
    setResult(null);
    setDeleteError(null);
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cleanup/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: filters.tenantId ? Number(filters.tenantId) : undefined,
          status: filters.status || undefined,
          before: filters.before || undefined,
          after: filters.after || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Preview failed");
      setPreview({ count: json.count });
    } catch (e: any) {
      setPreviewError(String(e?.message ?? e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function runDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/cleanup/quotes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: filters.tenantId ? Number(filters.tenantId) : undefined,
          status: filters.status || undefined,
          before: filters.before || undefined,
          after: filters.after || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Delete failed");
      setResult({ deleted: json.deleted });
      setPreview(null);
      setConfirm(false);
    } catch (e: any) {
      setDeleteError(String(e?.message ?? e));
      setConfirm(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <SectionCard>
      <div>
        <div className="text-sm font-semibold text-neutral-200">Quotes &amp; Line Items</div>
        <div className="text-xs text-neutral-500 mt-0.5">
          Deletes matching quotes + layout packages. Locked (RFM) quotes are always excluded.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isSuperOwner && (
          <LabelRow label="Tenant">
            <select className={inputCls()} value={filters.tenantId} onChange={(e) => patch("tenantId", e.target.value)}>
              <option value="">All tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </select>
          </LabelRow>
        )}

        <LabelRow label="Status">
          <select className={inputCls()} value={filters.status} onChange={(e) => patch("status", e.target.value)}>
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="rfm">RFM</option>
            <option value="approved">Approved</option>
          </select>
        </LabelRow>

        <LabelRow label="Created before">
          <input type="date" className={inputCls()} value={filters.before} onChange={(e) => patch("before", e.target.value)} />
        </LabelRow>

        <LabelRow label="Created after">
          <input type="date" className={inputCls()} value={filters.after} onChange={(e) => patch("after", e.target.value)} />
        </LabelRow>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="px-3 py-1.5 text-sm rounded border border-neutral-600 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          onClick={runPreview}
          disabled={previewBusy}
        >
          {previewBusy ? "Checking…" : "Preview count"}
        </button>

        {preview !== null && (
          <button
            className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
            onClick={() => setConfirm(true)}
            disabled={preview.count === 0}
          >
            Delete {preview.count.toLocaleString()} quotes
          </button>
        )}
      </div>

      {previewError && <StatusBadge color="red">Preview error: {previewError}</StatusBadge>}
      {deleteError && <StatusBadge color="red">Delete error: {deleteError}</StatusBadge>}
      {preview !== null && (
        <StatusBadge color={preview.count === 0 ? "neutral" : "amber"}>
          {preview.count === 0
            ? "No matching quotes found (locked quotes are excluded)."
            : `${preview.count.toLocaleString()} quotes match — locked/RFM quotes excluded.`}
        </StatusBadge>
      )}
      {result !== null && (
        <StatusBadge color="emerald">
          ✓ Deleted {result.deleted.toLocaleString()} quotes successfully.
        </StatusBadge>
      )}

      {confirm && preview && (
        <ConfirmModal
          state={{ tab: "quotes", preview }}
          onCancel={() => setConfirm(false)}
          onConfirm={runDelete}
          busy={deleteBusy}
        />
      )}
    </SectionCard>
  );
}

// ── users section ──────────────────────────────────────────────────────────────

function UsersSection({
  isSuperOwner,
  tenants,
}: {
  isSuperOwner: boolean;
  tenants: { id: number; name: string; slug: string }[];
}) {
  const [filters, setFilters] = React.useState<UserFilters>({
    tenantId: "",
    role: "",
    before: "",
    after: "",
    hasNoQuotes: false,
  });
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ deleted: number } | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  function patch(k: keyof UserFilters, v: any) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPreview(null);
    setResult(null);
    setDeleteError(null);
  }

  function buildBody() {
    return {
      tenantId: filters.tenantId ? Number(filters.tenantId) : undefined,
      role: filters.role || undefined,
      before: filters.before || undefined,
      after: filters.after || undefined,
      hasNoQuotes: filters.hasNoQuotes || undefined,
    };
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cleanup/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Preview failed");
      setPreview({ count: json.count });
    } catch (e: any) {
      setPreviewError(String(e?.message ?? e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function runDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/cleanup/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Delete failed");
      setResult({ deleted: json.deleted });
      setPreview(null);
      setConfirm(false);
    } catch (e: any) {
      setDeleteError(String(e?.message ?? e));
      setConfirm(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <SectionCard>
      <div>
        <div className="text-sm font-semibold text-neutral-200">Sales Reps &amp; Users</div>
        <div className="text-xs text-neutral-500 mt-0.5">
          Users with locked quotes are never deleted. Their quotes will have sales rep cleared.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isSuperOwner && (
          <LabelRow label="Tenant">
            <select className={inputCls()} value={filters.tenantId} onChange={(e) => patch("tenantId", e.target.value)}>
              <option value="">All tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </select>
          </LabelRow>
        )}

        <LabelRow label="Role">
          <select className={inputCls()} value={filters.role} onChange={(e) => patch("role", e.target.value)}>
            <option value="">Any role</option>
            <option value="sales">Sales</option>
            <option value="cs">CS</option>
            <option value="admin">Admin</option>
          </select>
        </LabelRow>

        <LabelRow label="Created before">
          <input type="date" className={inputCls()} value={filters.before} onChange={(e) => patch("before", e.target.value)} />
        </LabelRow>

        <LabelRow label="Created after">
          <input type="date" className={inputCls()} value={filters.after} onChange={(e) => patch("after", e.target.value)} />
        </LabelRow>
      </div>

      <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.hasNoQuotes}
          onChange={(e) => patch("hasNoQuotes", e.target.checked)}
          className="rounded"
        />
        Only users with zero quotes
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="px-3 py-1.5 text-sm rounded border border-neutral-600 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          onClick={runPreview}
          disabled={previewBusy}
        >
          {previewBusy ? "Checking…" : "Preview count"}
        </button>

        {preview !== null && (
          <button
            className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
            onClick={() => setConfirm(true)}
            disabled={preview.count === 0}
          >
            Delete {preview.count.toLocaleString()} users
          </button>
        )}
      </div>

      {previewError && <StatusBadge color="red">Preview error: {previewError}</StatusBadge>}
      {deleteError && <StatusBadge color="red">Delete error: {deleteError}</StatusBadge>}
      {preview !== null && (
        <StatusBadge color={preview.count === 0 ? "neutral" : "amber"}>
          {preview.count === 0
            ? "No matching users found (users with locked quotes excluded)."
            : `${preview.count.toLocaleString()} users match — those with locked quotes excluded.`}
        </StatusBadge>
      )}
      {result !== null && (
        <StatusBadge color="emerald">
          ✓ Deleted {result.deleted.toLocaleString()} users successfully.
        </StatusBadge>
      )}

      {confirm && preview && (
        <ConfirmModal
          state={{ tab: "users", preview }}
          onCancel={() => setConfirm(false)}
          onConfirm={runDelete}
          busy={deleteBusy}
        />
      )}
    </SectionCard>
  );
}

// ── tenants section (super-owner only) ────────────────────────────────────────

function TenantsSection({
  tenants,
}: {
  tenants: { id: number; name: string; slug: string }[];
}) {
  const [filters, setFilters] = React.useState<TenantFilters>({
    slug: "",
    active: "all",
    before: "",
    after: "",
  });
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ deleted: number } | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  function patch(k: keyof TenantFilters, v: any) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPreview(null);
    setResult(null);
    setDeleteError(null);
  }

  function buildBody() {
    return {
      slug: filters.slug || undefined,
      active: filters.active === "all" ? undefined : filters.active === "true",
      before: filters.before || undefined,
      after: filters.after || undefined,
    };
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cleanup/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Preview failed");
      setPreview({ count: json.count, quoteCount: json.quoteCount, userCount: json.userCount, tenantIds: json.tenantIds });
    } catch (e: any) {
      setPreviewError(String(e?.message ?? e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function runDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/cleanup/tenants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Delete failed");
      setResult({ deleted: json.deleted });
      setPreview(null);
      setConfirm(false);
    } catch (e: any) {
      setDeleteError(String(e?.message ?? e));
      setConfirm(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <SectionCard>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-neutral-200">Tenants</div>
          <div className="text-xs text-neutral-500 mt-0.5">
            Cascade-deletes all tenant data: users, quotes, layout packages, payouts. The{" "}
            <span className="font-mono text-neutral-400">default</span> tenant is always protected.
          </div>
        </div>
        <span className="text-[10px] border border-amber-500/30 text-amber-400 rounded px-1.5 py-0.5 ml-3 flex-shrink-0">
          Owner only
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <LabelRow label="Specific slug">
          <select className={inputCls()} value={filters.slug} onChange={(e) => patch("slug", e.target.value)}>
            <option value="">Any tenant</option>
            {tenants.filter((t) => t.slug !== "default").map((t) => (
              <option key={t.id} value={t.slug}>{t.name} ({t.slug})</option>
            ))}
          </select>
        </LabelRow>

        <LabelRow label="Active status">
          <select className={inputCls()} value={filters.active} onChange={(e) => patch("active", e.target.value)}>
            <option value="all">Any</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </LabelRow>

        <LabelRow label="Created before">
          <input type="date" className={inputCls()} value={filters.before} onChange={(e) => patch("before", e.target.value)} />
        </LabelRow>

        <LabelRow label="Created after">
          <input type="date" className={inputCls()} value={filters.after} onChange={(e) => patch("after", e.target.value)} />
        </LabelRow>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="px-3 py-1.5 text-sm rounded border border-neutral-600 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          onClick={runPreview}
          disabled={previewBusy}
        >
          {previewBusy ? "Checking…" : "Preview count"}
        </button>

        {preview !== null && (
          <button
            className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
            onClick={() => setConfirm(true)}
            disabled={preview.count === 0}
          >
            Delete {preview.count.toLocaleString()} tenant{preview.count !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {previewError && <StatusBadge color="red">Preview error: {previewError}</StatusBadge>}
      {deleteError && <StatusBadge color="red">Delete error: {deleteError}</StatusBadge>}
      {preview !== null && (
        <StatusBadge color={preview.count === 0 ? "neutral" : "red"}>
          {preview.count === 0
            ? "No matching tenants found."
            : `${preview.count.toLocaleString()} tenant${preview.count !== 1 ? "s" : ""} match — includes ${preview.quoteCount?.toLocaleString()} quotes and ${preview.userCount?.toLocaleString()} users.`}
        </StatusBadge>
      )}
      {result !== null && (
        <StatusBadge color="emerald">
          ✓ Deleted {result.deleted.toLocaleString()} tenant{result.deleted !== 1 ? "s" : ""} and all associated data.
        </StatusBadge>
      )}

      {confirm && preview && (
        <ConfirmModal
          state={{ tab: "tenants", preview }}
          onCancel={() => setConfirm(false)}
          onConfirm={runDelete}
          busy={deleteBusy}
        />
      )}
    </SectionCard>
  );
}

// ── main page ──────────────────────────────────────────────────────────────────

export default function CleanupPage() {
  const [tab, setTab] = React.useState<Tab>("quotes");
  const [isSuperOwner, setIsSuperOwner] = React.useState(false);
  const [tenants, setTenants] = React.useState<{ id: number; name: string; slug: string }[]>([]);
  const [authLoaded, setAuthLoaded] = React.useState(false);

  React.useEffect(() => {
    async function init() {
      try {
        // Check who's logged in
        const whoRes = await fetch(`/api/auth/whoami?t=${Math.random()}`, { cache: "no-store" });
        const who = await whoRes.json().catch(() => null);
        const email = who?.ok && who?.user?.email ? String(who.user.email).trim().toLowerCase() : "";
        const superOwner = email === "25thhourdesign@gmail.com";
        setIsSuperOwner(superOwner);

        // Load tenant list (for dropdowns)
        if (superOwner) {
          const tRes = await fetch("/api/admin/tenants", { cache: "no-store" });
          const tJson = await tRes.json().catch(() => null);
          if (tJson?.ok && Array.isArray(tJson.tenants)) {
            setTenants(tJson.tenants.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })));
          }
        }
      } catch {
        // non-fatal
      } finally {
        setAuthLoaded(true);
      }
    }
    init();
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: "quotes", label: "Quotes" },
    { key: "users", label: "Users / Sales Reps" },
    ...(isSuperOwner ? [{ key: "tenants" as Tab, label: "Tenants" }] : []),
  ];

  return (
    <div className="p-6 space-y-6 text-neutral-100 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xl font-semibold text-neutral-100">Data Cleanup</div>
          <div className="text-xs text-neutral-500 mt-1">
            Remove test data before launch. Preview before deleting — locked/RFM records are always protected.
          </div>
        </div>
        <div className="text-[10px] border border-neutral-700 rounded px-2 py-1 text-neutral-500">
          Audit-logged
        </div>
      </div>

      {/* Warning banner */}
      <div className="border border-amber-500/25 bg-amber-500/5 rounded-lg px-4 py-3 text-xs text-amber-300/80 flex items-start gap-2">
        <span className="flex-shrink-0 mt-0.5">⚠</span>
        <span>
          Deletions are <strong className="text-amber-200">permanent and immediate</strong>. Use "Preview count" to verify
          what will be deleted before confirming. All actions are written to the audit log.
        </span>
      </div>

      {/* Tabs */}
      {authLoaded && (
        <>
          <div className="flex gap-1 border-b border-neutral-800">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-neutral-300 text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div>
            {tab === "quotes" && <QuotesSection isSuperOwner={isSuperOwner} tenants={tenants} />}
            {tab === "users" && <UsersSection isSuperOwner={isSuperOwner} tenants={tenants} />}
            {tab === "tenants" && isSuperOwner && <TenantsSection tenants={tenants} />}
          </div>
        </>
      )}

      {!authLoaded && (
        <div className="text-xs text-neutral-500">Loading…</div>
      )}
    </div>
  );
}
