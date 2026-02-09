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
import { useRouter } from "next/navigation";


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

export default function AdminHomePage() {
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

        {/* Users & Roles (Admin-only via API enforcement) */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
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

          {error && <p className="text-[11px] text-rose-300">{error}</p>}
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


  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<"viewer" | "sales" | "cs" | "admin">(
    "viewer",
  );
  const [password, setPassword] = React.useState("");
  const [salesSlug, setSalesSlug] = React.useState("");

  async function loadUsers() {
    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
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
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          Create user
        </div>
        <span className="inline-flex items-center rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300">
          Admin only
        </span>
      </div>

      <p className="text-xs text-slate-200">
        Create internal accounts for testing login + role gates (viewer/sales/cs/admin).
        This tool is enforced server-side; non-admins will receive 401/403 JSON.
      </p>

      <form onSubmit={handleCreate} className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-[11px] text-slate-400">Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/40 focus:border-sky-400 focus:ring-1"
              placeholder="user@alex-io.com"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-slate-400">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/40 focus:border-sky-400 focus:ring-1"
              placeholder="Jane Doe"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-slate-400">Role</div>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "viewer" | "sales" | "cs" | "admin")
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/40 focus:border-sky-400 focus:ring-1"
            >
              <option value="viewer">viewer</option>
              <option value="sales">sales</option>
              <option value="cs">cs</option>
              <option value="admin">admin</option>
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-slate-400">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/40 focus:border-sky-400 focus:ring-1"
              placeholder="••••••••"
              type="password"
              autoComplete="new-password"
            />
          </label>

          <label className="block md:col-span-2">
            <div className="mb-1 text-[11px] text-slate-400">
              Sales slug (optional, unique)
            </div>
            <input
              value={salesSlug}
              onChange={(e) => setSalesSlug(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/40 focus:border-sky-400 focus:ring-1"
              placeholder="chuck (or leave blank)"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center rounded-full border border-sky-500/60 bg-sky-600/20 px-3 py-1 text-[11px] font-medium text-sky-200 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create user"}
          </button>

          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex items-center rounded-full border border-slate-600/60 bg-slate-800/30 px-3 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-slate-800/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh list"}
          </button>

          {okMsg && <span className="text-[11px] text-emerald-300">{okMsg}</span>}
          {tempPassword && resetForEmail && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-100">
              <div className="mb-1 font-medium">
                Temporary password for <span className="text-amber-200">{resetForEmail}</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="rounded bg-black/30 px-2 py-1">{tempPassword}</code>
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
                  className="inline-flex items-center rounded-full border border-slate-600/60 bg-slate-800/30 px-2 py-0.5 text-[10px] font-medium text-slate-200 transition hover:bg-slate-800/50"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTempPassword(null);
                    setResetForEmail(null);
                  }}
                  className="inline-flex items-center rounded-full border border-slate-600/60 bg-slate-800/30 px-2 py-0.5 text-[10px] font-medium text-slate-200 transition hover:bg-slate-800/50"
                >
                  Dismiss
                </button>
              </div>
              <div className="mt-1 text-[10px] text-amber-200/80">
                This password is shown once. It is not stored in plaintext.
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </form>

      <div className="mt-4 border-t border-slate-800 pt-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          Existing users
        </div>

        {loading && (
          <p className="text-[11px] text-slate-400">Loading users…</p>
        )}

        {!loading && users && Array.isArray(users) && users.length === 0 && (
          <p className="text-[11px] text-slate-400">
            No users returned (or you are not logged in as admin).
          </p>
        )}

        {!loading && Array.isArray(users) && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                               <tr className="text-slate-400">
                  <th className="py-1 pr-3">Email</th>
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Role</th>
                  <th className="py-1 pr-3">Sales slug</th>
                  <th className="py-1 pr-3">Link</th>
                  <th className="py-1 pr-3">Created</th>
                  <th className="py-1 pr-3">Password</th>
                  <th className="py-1 pr-0 text-right">Delete</th>
                </tr>

              </thead>
              <tbody>
                {users.map((u: any) => (
                                <tr key={u.id} className="border-t border-slate-800/60">
                    <td className="py-1 pr-3 text-slate-200">{u.email}</td>
                    <td className="py-1 pr-3 text-slate-200">{u.name}</td>
                    <td className="py-1 pr-3 text-slate-200">{u.role}</td>
                    <td className="py-1 pr-3 text-slate-300">
                      {u.sales_slug || "—"}
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
                          className="inline-flex items-center rounded-full border border-slate-600/60 bg-slate-800/30 px-2 py-0.5 text-[10px] font-medium text-slate-200 transition hover:bg-slate-800/50 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Copy salesperson start link"
                        >
                          Copy
                        </button>
                      ) : (
                        <span className="text-slate-500"></span>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-slate-400">
                      {typeof u.created_at === "string"
                        ? u.created_at.slice(0, 10)
                        : "—"}
                    </td>
                    <td className="py-1 pr-3">
                      <button
                        type="button"
                        onClick={() => handleResetPassword({ id: u.id, email: u.email })}
                        disabled={resettingId === u.id || deletingId === u.id || saving || loading}
                        className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-600/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 transition hover:bg-amber-600/20 disabled:cursor-not-allowed disabled:opacity-60"
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
                        className="inline-flex items-center rounded-full border border-rose-500/50 bg-rose-600/10 px-2 py-0.5 text-[10px] font-medium text-rose-200 transition hover:bg-rose-600/20 disabled:cursor-not-allowed disabled:opacity-60"
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


