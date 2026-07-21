// app/admin/AdminHomeClient.tsx
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
import { useRouter } from "next/navigation";

type AdminHomeClientProps = {
  dashboardTitle: string;
};


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

type AdminUsersListResponse =
  | {
      ok: true;
      users: Array<{
        id: number;
        email: string;
        name: string;
        role: string;
        sales_slug: string | null;
        commission_pct: number | null;
        created_at: string;
        updated_at: string;
      }>;
    }
  | { ok: false; error: string; message?: string };

type AdminUserCreateResponse =
  | {
      ok: true;
      user: {
        id: number;
        email: string;
        name: string;
        role: string;
        sales_slug: string | null;
        created_at: string;
        updated_at: string;
      };
    }
  | { ok: false; error: string; message?: string };

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

export default function AdminHomeClient({ dashboardTitle }: AdminHomeClientProps) {
  const router = useRouter();

  // Guard: only admins should see the /admin dashboard.
  // Sales/CS can still use /admin/quotes, but should not land on this hub.
  React.useEffect(() => {
    let active = true;

    async function checkAdmin() {
      try {
        const res = await fetch("/api/admin/users?limit=1", { cache: "no-store" });

        // /api/admin/users is admin-only. If we get 401/403, this user is not admin.
        if (!active) return;
        if (res.status === 401 || res.status === 403) {
          router.replace("/admin/quotes");
        }
      } catch {
        // If the check fails (network/etc), do nothing (avoid locking admin out).
      }
    }

    checkAdmin();

    return () => {
      active = false;
    };
  }, [router]);

  const dbHealth = useHealth("/api/health/db");

  const hubspotHealth = useHealth("/api/health/hubspot");
  const emailHealth = useHealth("/api/health/email");

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-8 border-b border-[var(--border)] pb-6">
          <h1 className="text-3xl font-medium tracking-tight text-[var(--text-primary)]">
            {dashboardTitle}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Internal tools for quotes, layouts, pricing &amp; foam data.
          </p>
        </header>

        {/* System health row */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
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
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
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

            {/* Pricing / price books — hidden */}
            {/* <NavCard
              href="/admin/pricing"
              title="Pricing & price books"
              description="View price books and run pricing sandbox tests without affecting real quotes."
            /> */}

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

            <NavCard
              href="/admin/commissions"
              title="Commissions"
              description="Sales rep commission rates, quote totals, and earned commission amounts."
            />

            {/* Logs — hidden */}
            {/* <NavCard
              href="/admin/logs"
              title="Logs & events"
              description="Inspect webhook events, error logs, and other system diagnostics."
            /> */}
          </div>
        </section>

        {/* Rough shipping estimate knob - moved under Admin Areas */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Rough Shipping Estimate
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ShippingSettingsCard />
          </div>
        </section>

        {/* Users & Roles (Admin-only via API enforcement) */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Users &amp; Roles
          </h2>
          <div className="grid gap-4">
            <UsersAndRolesCard />
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
    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--border-strong)]";
  let detailText = "Tests coming soon.";
  let extraLine: string | null = null;

  if (loading) {
    statusLabel = "Checking…";
    detailText = "Running health probe…";
  } else if (error) {
    statusLabel = "Down";
    statusClass =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[var(--attention-bg)] text-[var(--attention)] border border-[var(--attention-border)]";
    detailText = error;
  } else if (data) {
    if (flavor === "db") {
      if (data.ok && data.status === "up") {
        statusLabel = "Up";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-text)]/30";
        detailText =
          data.detail ||
          "Database connection OK and basic query succeeded.";
        if (typeof data.latency_ms === "number") {
          extraLine = `Last check: ~${data.latency_ms} ms`;
        }
      } else {
        statusLabel = "Down";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[var(--attention-bg)] text-[var(--attention)] border border-[var(--attention-border)]";
        detailText =
          data.message || data.detail || "Database health check failed.";
      }
    } else {
      const configured = !!data.configured;
      if (configured) {
        statusLabel = "Configured";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-text)]/30";
        detailText =
          data.detail ||
          "Required environment variables are present for this integration.";
      } else {
        statusLabel = "Not configured";
        statusClass =
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] border border-[var(--status-pending-text)]/30";
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          {title}
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div className="text-xs text-[var(--text-secondary)]">{description}</div>
      <div className="mt-2 text-[11px] text-[var(--text-muted)]">{detailText}</div>
      {extraLine && (
        <div className="mt-1 text-[11px] text-[var(--text-faint)]">{extraLine}</div>
      )}

      {/* Deep check UI for HubSpot + Graph */}
      {(flavor === "hubspot" || flavor === "email") && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <button
            type="button"
            onClick={runDeepCheck}
            disabled={deepLoading}
            className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deepLoading ? "Running deep check…" : "Run deep check"}
          </button>
          {deepResult && !deepError && (
            <p className="mt-2 text-[11px] text-[var(--status-success-text)]">{deepResult}</p>
          )}
          {deepError && (
            <p className="mt-2 text-[11px] text-[var(--attention)]">{deepError}</p>
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
      className="group flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm transition hover:border-[var(--action-primary)]/50 hover:bg-[var(--surface-card)]"
    >
      <div className="mb-2 text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--action-primary)]">
        {title}
      </div>
      <p className="flex-1 text-xs text-[var(--text-secondary)]">{description}</p>
      <div className="mt-3 text-[11px] text-[var(--text-faint)]">
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Rough shipping %
        </div>
        <span className="inline-flex items-center rounded-full bg-[var(--status-neutral-bg)] px-2 py-0.5 text-[10px] text-[var(--status-neutral-text)]">
          Global knob
        </span>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        Controls the <span className="font-medium">rough shipping estimate</span>{" "}
        as a percentage of the combined{" "}
        <span className="font-mono">foam + packaging</span> subtotal.
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
              className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1 disabled:opacity-60"
            />
            <span className="text-xs text-[var(--text-muted)]">%</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={disabled}
              className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save rough shipping %"}
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

// ---------- Users & Roles card ----------

function UsersAndRolesCard() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [users, setUsers] = React.useState<AdminUsersListResponse extends any ? any : never>([]);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const [resettingId, setResettingId] = React.useState<number | null>(null);
  const [resetForEmail, setResetForEmail] = React.useState<string | null>(null);
  const [tempPassword, setTempPassword] = React.useState<string | null>(null);

  // Commission % — local edits per user id before saving
  const [commissionEdits, setCommissionEdits] = React.useState<Record<number, string>>({});
  const [savingCommissionId, setSavingCommissionId] = React.useState<number | null>(null);

  async function saveCommission(userId: number) {
    const raw = commissionEdits[userId];
    const pct = raw === "" || raw === null || raw === undefined ? null : Number(raw);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setError("Commission % must be between 0 and 100.");
      return;
    }
    setSavingCommissionId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, commission_pct: pct }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || json.error || "Save failed");
      setOkMsg("Commission rate saved.");
      // Update local users list so UI reflects saved value
      setUsers((prev: any[]) =>
        prev.map((u: any) => u.id === userId ? { ...u, commission_pct: pct } : u)
      );
    } catch (err: any) {
      setError(err.message || "Failed to save commission rate.");
    } finally {
      setSavingCommissionId(null);
    }
  }


  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<"viewer" | "sales" | "cs" | "admin">(
    "viewer",
  );
  const [password, setPassword] = React.useState("");
  const [salesSlug, setSalesSlug] = React.useState("");
  // Owner-only: view/manage a different tenant's users. Blank = your own
  // tenant, same as before. Deliberately a plain ID input rather than a
  // fetched dropdown of every tenant — the actual need here is narrow
  // (recover access to one specific tenant), not general-purpose
  // multi-tenant browsing.
  const [viewTenantId, setViewTenantId] = React.useState("");

  async function loadUsers() {
    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      const tenantParam = viewTenantId.trim() ? `?tenant_id=${encodeURIComponent(viewTenantId.trim())}` : "";
      const res = await fetch(`/api/admin/users${tenantParam}`, { cache: "no-store" });
      const json = (await res
        .json()
        .catch(() => null)) as AdminUsersListResponse | null;

      if (!res.ok || !json || !("ok" in json) || json.ok !== true) {
        const msg =
          (json && (json as any).message) ||
          "Users list is locked. Log in as admin.";
        setError(msg);
        setUsers([]);
      } else {
        setUsers(json.users || []);
        setError(null);
      }
    } catch (e) {
      console.error("Failed to load users:", e);
      setError("Failed to load users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDeleteUser(user: { id: number; email: string }) {
    const ok = window.confirm(
      `Delete user "${user.email}"?\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    setError(null);
    setOkMsg(null);
    setDeletingId(user.id);

    try {
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(String(user.id))}`, {
        method: "DELETE",
        cache: "no-store",
      });

      const json: any = await res.json().catch(() => null);

      if (!res.ok || !json || json.ok !== true) {
        const msg =
          (json && (json.message || json.error)) ||
          "Failed to delete user. Check role/login.";
        setError(msg);
        setOkMsg(null);
      } else {
        setOkMsg(`Deleted user: ${user.email}`);
        setError(null);
        await loadUsers();
      }
    } catch (e) {
      console.error("Failed to delete user:", e);
      setError("Failed to delete user.");
      setOkMsg(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleResetPassword(user: { id: number; email: string }) {
    const ok = window.confirm(
      `Reset password for "${user.email}"?\n\nThis will set a NEW temporary password.`,
    );
    if (!ok) return;

    setError(null);
    setOkMsg(null);
    setTempPassword(null);
    setResetForEmail(null);
    setResettingId(user.id);

    try {
      const res = await fetch(
        `/api/admin/users?id=${encodeURIComponent(String(user.id))}`,
        { method: "PATCH", cache: "no-store" },
      );

      const json: any = await res.json().catch(() => null);

      if (!res.ok || !json || json.ok !== true || typeof json.temp_password !== "string") {
        const msg =
          (json && (json.message || json.error)) ||
          "Failed to reset password. Check role/login.";
        setError(msg);
        setOkMsg(null);
      } else {
        setResetForEmail(user.email);
        setTempPassword(json.temp_password);
        setOkMsg(`Password reset: ${user.email}`);
        setError(null);
      }
    } catch (e) {
      console.error("Failed to reset password:", e);
      setError("Failed to reset password.");
      setOkMsg(null);
    } finally {
      setResettingId(null);
    }
  }


  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    const emailTrim = email.trim();
    const nameTrim = name.trim();

    if (!emailTrim || !nameTrim || !password) {
      setError("Email, name, and password are required.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailTrim,
          name: nameTrim,
          role,
          password,
          sales_slug: salesSlug.trim() || null,
          tenant_id: viewTenantId.trim() || undefined,
        }),
      });

      const json = (await res
        .json()
        .catch(() => null)) as AdminUserCreateResponse | null;

      if (!res.ok || !json || !("ok" in json) || json.ok !== true) {
        const msg =
          (json && (json as any).message) ||
          "Failed to create user. Check role/login.";
        setError(msg);
        setOkMsg(null);
      } else {
        setOkMsg(`Created user: ${json.user.email} (${json.user.role})`);
        setError(null);
        setEmail("");
        setName("");
        setPassword("");
        setSalesSlug("");
        await loadUsers();
      }
    } catch (e) {
      console.error("Failed to create user:", e);
      setError("Failed to create user.");
      setOkMsg(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Create user
        </div>
        <span className="inline-flex items-center rounded-full bg-[var(--status-neutral-bg)] px-2 py-0.5 text-[10px] text-[var(--status-neutral-text)]">
          Admin only
        </span>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        Create internal accounts for testing login + role gates (viewer/sales/cs/admin).
        This tool is enforced server-side; non-admins will receive 401/403 JSON.
      </p>

      <form onSubmit={handleCreate} className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
              placeholder="user@alex-io.com"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
              placeholder="Jane Doe"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Role</div>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "viewer" | "sales" | "cs" | "admin")
              }
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
            >
              <option value="viewer">viewer</option>
              <option value="sales">sales</option>
              <option value="cs">cs</option>
              <option value="admin">admin</option>
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
              placeholder="••••••••"
              type="password"
              autoComplete="new-password"
            />
          </label>

          <label className="block md:col-span-2">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">
              Sales slug (optional, unique)
            </div>
            <input
              value={salesSlug}
              onChange={(e) => setSalesSlug(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
              placeholder="chuck (or leave blank)"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create user"}
          </button>

          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh list"}
          </button>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-faint)]">Tenant ID (owner only):</span>
            <input
              type="text"
              value={viewTenantId}
              onChange={(e) => setViewTenantId(e.target.value)}
              placeholder="your own"
              title="Blank = your own tenant. Only has an effect for the platform owner account — everyone else always sees their own tenant regardless."
              className="w-20 rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1 text-[11px] text-[var(--text-primary)]"
            />
            <button
              type="button"
              onClick={loadUsers}
              className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-page)]"
            >
              View
            </button>
          </div>

          {okMsg && <span className="text-[11px] text-[var(--status-success-text)]">{okMsg}</span>}
          {tempPassword && resetForEmail && (
            <div className="mt-2 rounded-lg border border-[var(--status-pending-text)]/30 bg-[var(--status-pending-bg)] p-2 text-[11px] text-[var(--status-pending-text)]">
              <div className="mb-1 font-medium">
                Temporary password for <span className="text-[var(--status-pending-text)]">{resetForEmail}</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="rounded bg-[var(--surface-card)] px-2 py-1">{tempPassword}</code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(tempPassword);
                      setOkMsg("Copied temporary password.");
                    } catch {
                      // no-op; clipboard may be blocked
                    }
                  }}
                  className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-page)]"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTempPassword(null);
                    setResetForEmail(null);
                  }}
                  className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-page)]"
                >
                  Dismiss
                </button>
              </div>
              <div className="mt-1 text-[10px] text-[var(--status-pending-text)]/80">
                This password is shown once. It is not stored in plaintext.
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-[var(--attention)]">{error}</p>}
      </form>

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Existing users
        </div>

        {loading && (
          <p className="text-[11px] text-[var(--text-muted)]">Loading users…</p>
        )}

        {!loading && users && Array.isArray(users) && users.length === 0 && (
          <p className="text-[11px] text-[var(--text-muted)]">
            No users returned (or you are not logged in as admin).
          </p>
        )}

        {!loading && Array.isArray(users) && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-[var(--text-muted)]">
                  <th className="py-1 pr-3">Email</th>
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Role</th>
                  <th className="py-1 pr-3">Sales slug</th>
                  <th className="py-1 pr-3">Commission %</th>
                  <th className="py-1 pr-3">Link</th>
                  <th className="py-1 pr-3">Created</th>
                  <th className="py-1 pr-3">Password</th>
                  <th className="py-1 pr-0 text-right">Delete</th>
                </tr>

              </thead>
              <tbody>
                {users.map((u: any) => (
                                <tr key={u.id} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-3 text-[var(--text-secondary)]">{u.email}</td>
                    <td className="py-1 pr-3 text-[var(--text-secondary)]">{u.name}</td>
                    <td className="py-1 pr-3 text-[var(--text-secondary)]">{u.role}</td>
                    <td className="py-1 pr-3 text-[var(--text-muted)]">
                      {u.sales_slug || "—"}
                    </td>
                    <td className="py-1 pr-3">
                      {u.sales_slug ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            placeholder={u.commission_pct != null ? String(u.commission_pct) : "0"}
                            value={commissionEdits[u.id] !== undefined ? commissionEdits[u.id] : (u.commission_pct != null ? String(u.commission_pct) : "")}
                            onChange={(e) =>
                              setCommissionEdits((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                            className="w-16 rounded border border-[var(--border)] bg-[var(--surface-page)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                          />
                          <span className="text-[10px] text-[var(--text-faint)]">%</span>
                          <button
                            type="button"
                            onClick={() => saveCommission(u.id)}
                            disabled={savingCommissionId === u.id}
                            className="rounded bg-[var(--action-primary)] px-1.5 py-0.5 text-[10px] text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-50"
                          >
                            {savingCommissionId === u.id ? "…" : "Save"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--text-faint)] text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      {u.sales_slug ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const origin =
                                typeof window !== "undefined"
                                  ? window.location.origin
                                  : "";
                              const link = `${origin}/q/${encodeURIComponent(String(u.sales_slug))}`;

                              await navigator.clipboard.writeText(link);
                              setOkMsg(`Copied start link for ${u.email}`);
                              setError(null);
                            } catch {
                              // Clipboard can be blocked; fail silently (no regressions)
                              setError("Copy failed (clipboard blocked).");
                              setOkMsg(null);
                            }
                          }}
                          disabled={resettingId === u.id || deletingId === u.id || saving || loading}
                          className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-60"
                          title="Copy salesperson start link"
                        >
                          Copy
                        </button>
                      ) : (
                        <span className="text-[var(--text-faint)]"></span>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-[var(--text-muted)]">
                      {typeof u.created_at === "string"
                        ? u.created_at.slice(0, 10)
                        : "—"}
                    </td>
                    <td className="py-1 pr-3">
                      <button
                        type="button"
                        onClick={() => handleResetPassword({ id: u.id, email: u.email })}
                        disabled={resettingId === u.id || deletingId === u.id || saving || loading}
                        className="inline-flex items-center rounded-full border border-[var(--status-pending-text)]/30 bg-[var(--status-pending-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--status-pending-text)] transition hover:bg-[var(--status-pending-bg)]/70 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Reset password (sets a new temporary password)"
                      >
                        {resettingId === u.id ? "Resetting" : "Reset"}
                      </button>
                    </td>
                    <td className="py-1 pr-0 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteUser({ id: u.id, email: u.email })}
                        disabled={deletingId === u.id || saving || loading}
                        className="inline-flex items-center rounded-full border border-[var(--attention-border)] bg-[var(--attention-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--attention)] transition hover:bg-[var(--attention-bg)]/70 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Delete user"
                      >
                        {deletingId === u.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>

                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


