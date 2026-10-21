// components/admin/UsersAndRolesCard.tsx
//
// Step 38B: the shop's users (invite by email, roles, referral names,
// commission %, password reset / re-invite, delete) and the mileage rate.
// Moved unchanged from the admin Home (app/admin/AdminHomeClient.tsx) to
// its own page, /admin/team (menu: Shop settings → Team & users). The
// "Tenant ID (owner only)" box now shows only to the platform owner.

"use client";

import * as React from "react";

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

// ---------- Mileage reimbursement rate (tenant-wide) ----------
// One $/mile rate for the whole business, used by the expense tracker
// (/admin/expenses) to auto-calculate mileage expenses. Lives here, next to
// commission %, since both are the "rep pay" knobs an admin tunes.

export function MileageRateControl() {
  const [rate, setRate] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/mileage-rate", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (active && json?.ok) setRate(String(json.mileage_rate_usd));
      } catch { /* silent */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  async function save() {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      setMsg("Rate must be between 0 and 10.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/mileage-rate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mileage_rate_usd: n }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || "Save failed");
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to save rate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-sm">
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
        Mileage reimbursement rate
      </div>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        One $/mile rate for every rep in this business — used to work out mileage on their Expenses page.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          max="10"
          disabled={loading}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
        />
        <span className="text-xs text-[var(--text-muted)]">/ mile</span>
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="ml-2 inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-[11px] text-[var(--text-muted)]">{msg}</span>}
      </div>
    </div>
  );
}

// ---------- Users & Roles card ----------

export default function UsersAndRolesCard({ isOwner = false }: { isOwner?: boolean }) {
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
  // Step 36B: the viewer role is retired (it could open nothing); sales is the default.
  const [role, setRole] = React.useState<"sales" | "cs" | "admin">(
    "sales",
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

    if (!emailTrim || !nameTrim) {
      setError("Email and name are required.");
      return;
    }

    setSaving(true);

    // Step 36A: no password = invite them by email (they set their own).
    if (!password) {
      try {
        const res = await fetch("/api/admin/users/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailTrim,
            name: nameTrim,
            role,
            sales_slug: salesSlug.trim() || null,
            tenant_id: viewTenantId.trim() || undefined,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; message?: string; email?: string; user: { email: string; role: string } }
          | null;
        if (!res.ok || !json?.ok) {
          setError(json?.message || "Failed to invite user.");
        } else {
          setEmail("");
          setName("");
          setSalesSlug("");
          // Step 36B: reload first (loadUsers clears the message), then say what happened.
          await loadUsers();
          setOkMsg(
            json.email === "sent"
              ? `Invited ${json.user.email} (${json.user.role}): they'll get an email to set their password.`
              : `Created ${json.user.email}, but the invite email didn't go out. Use "Invite" in the list to resend.`,
          );
        }
      } catch (e) {
        console.error("Failed to invite user:", e);
        setError("Failed to invite user.");
      } finally {
        setSaving(false);
      }
      return;
    }

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
        setError(null);
        setEmail("");
        setName("");
        setPassword("");
        setSalesSlug("");
        await loadUsers();
        setOkMsg(`Created user: ${json.user.email} (${json.user.role})`);
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
      <MileageRateControl />

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Create user
        </div>
        <span className="inline-flex items-center rounded-full bg-[var(--status-neutral-bg)] px-2 py-0.5 text-[10px] text-[var(--status-neutral-text)]">
          Admin only
        </span>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        Add your staff: sales, customer service (cs) or admin. Leave the password blank to email them an invite.
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
              placeholder="name@yourcompany.com"
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
                setRole(e.target.value as "sales" | "cs" | "admin")
              }
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1"
            >
              <option value="sales">sales</option>
              <option value="cs">cs</option>
              <option value="admin">admin</option>
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Password (leave blank to email them an invite)</div>
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
            {saving ? "Saving…" : password ? "Create user" : "Invite by email"}
          </button>

          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh list"}
          </button>

          {/* Step 38B: only the platform owner can look at another shop's users */}
          {isOwner ? (
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
          ) : null}

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
                      </button>{" "}
                      {/* Step 36A: email them a set-password link */}
                      <button
                        type="button"
                        onClick={async () => {
                          setError(null);
                          setOkMsg(null);
                          const r = await fetch("/api/admin/users/invite", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ user_id: u.id, resend: true, tenant_id: viewTenantId.trim() || undefined }),
                          }).catch(() => null);
                          const j = (r ? await r.json().catch(() => null) : null) as { ok?: boolean; message?: string } | null;
                          if (r && r.ok && j?.ok) setOkMsg(`Invite sent to ${u.email}.`);
                          else setError(j?.message || "Couldn't send the invite.");
                        }}
                        disabled={deletingId === u.id || saving || loading}
                        className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
                        title="Email a link to set their password (7 days)"
                        data-user-invite={u.id}
                      >
                        Invite
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
