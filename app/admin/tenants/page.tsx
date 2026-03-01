"use client";

import * as React from "react";

type Tenant = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  theme_json: any;
  created_at?: string;
};

type EditState = {
  name: string;
  active: boolean;
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  saving: boolean;
  error: string | null;
  ok: boolean;
};

function getThemeField(theme: any, key: string): string {
  const v = theme?.[key];
  return typeof v === "string" ? v : "";
}

function coreHost(): string {
  // Always treat the "default" tenant as the core apex host.
  return "api.alex-io.com";
}

function tenantHostForSlug(slug: string): string {
  const s = String(slug || "").trim().toLowerCase();

  // Default tenant uses the core host (no "default." prefix)
  if (s === "default") return coreHost();

  // For non-default tenants, build <slug>.<base>
  const host =
    typeof window !== "undefined" && window.location && window.location.host
      ? window.location.host
      : coreHost();

  const parts = host.split(".");
  // Keep last 3 labels (api.alex-io.com). If host is already <tenant>.api.alex-io.com, strip tenant.
  const base = parts.length >= 3 ? parts.slice(-3).join(".") : host;

  return `${s}.${base}`;
}

function tenantAdminUrl(slug: string): string {
  return `https://${tenantHostForSlug(slug)}/admin`;
}

// Tenant splash / landing page (themed + Start Quote button): /t/<tenant_slug>
function tenantLandingUrl(slug: string): string {
  const s = String(slug || "").trim().toLowerCase();
  return `https://${tenantHostForSlug(s)}/t/${encodeURIComponent(s)}`;
}

function tenantDisplayHost(slug: string): string {
  return tenantHostForSlug(slug);
}

function themeOf(t: Tenant) {
  const th = (t?.theme_json || {}) as any;
  return {
    brandName:
      typeof th?.brandName === "string" && th.brandName.trim() ? th.brandName.trim() : "",
    primaryColor:
      typeof th?.primaryColor === "string" && th.primaryColor.trim()
        ? th.primaryColor.trim()
        : "",
    secondaryColor:
      typeof th?.secondaryColor === "string" && th.secondaryColor.trim()
        ? th.secondaryColor.trim()
        : "",
    logoUrl: typeof th?.logoUrl === "string" && th.logoUrl.trim() ? th.logoUrl.trim() : "",
  };
}

function safeCssColor(v: string, fallback: string): string {
  const s = String(v || "").trim();
  // Minimal safety: accept common CSS color formats; otherwise fallback.
  if (!s) return fallback;
  if (s.startsWith("#")) return s;
  if (/^rgb(a)?\(/i.test(s)) return s;
  if (/^hsl(a)?\(/i.test(s)) return s;
  // Allow simple named colors if someone uses them
  if (/^[a-z]+$/i.test(s)) return s;
  return fallback;
}

// Owner-only tenant admin allowlist (UI)
const TENANT_WRITE_EMAIL_ALLOWLIST = new Set<string>(["25thhourdesign@gmail.com"]);

function canWriteTenantsEmail(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  return TENANT_WRITE_EMAIL_ALLOWLIST.has(e);
}

export default function TenantsPage() {
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [edit, setEdit] = React.useState<Record<number, EditState>>({});
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authedEmail, setAuthedEmail] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = React.useState<{
    slug: string;
    admin_email: string;
    temp_password: string;
  } | null>(null);

  async function loadWhoAmI() {
    try {
      const res = await fetch(`/api/auth/whoami?t=${Math.random()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const email =
        json?.ok && json?.authenticated && json?.user?.email ? String(json.user.email) : null;
      setAuthedEmail(email);
    } catch {
      setAuthedEmail(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function load() {
    const res = await fetch("/api/admin/tenants", { cache: "no-store" });
    const json = await res.json();

    if (json?.ok && Array.isArray(json.tenants)) {
      const list = json.tenants as Tenant[];
      setTenants(list);

      // Initialize edit state for any tenant not yet tracked
      setEdit((prev) => {
        const next = { ...prev };
        for (const t of list) {
          if (!next[t.id]) {
            next[t.id] = {
              name: t.name || "",
              active: !!t.active,
              brandName: getThemeField(t.theme_json, "brandName"),
              primaryColor: getThemeField(t.theme_json, "primaryColor"),
              secondaryColor: getThemeField(t.theme_json, "secondaryColor"),
              logoUrl: getThemeField(t.theme_json, "logoUrl"),
              saving: false,
              error: null,
              ok: false,
            };
          }
        }
        return next;
      });
    }
  }

  async function createTenant() {
    setCreateError(null);
    setCreatedCreds(null);

    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    });

    const json = await res.json();
    if (json?.ok) {
      setName("");
      setSlug("");
      if (json?.admin_email && json?.temp_password) {
        setCreatedCreds({
          slug: String(slug || "").trim().toLowerCase(),
          admin_email: String(json.admin_email),
          temp_password: String(json.temp_password),
        });
      }
      await load();
      return;
    }

    setCreateError(json?.message || json?.error || "Create failed.");
  }

  function updateEdit(id: number, patch: Partial<EditState>) {
    setEdit((prev) => ({
      ...prev,
      [id]: { ...(prev[id] as EditState), ...patch, ok: false, error: null },
    }));
  }

  async function saveTenant(id: number) {
    const s = edit[id];
    if (!s) return;

    updateEdit(id, { saving: true, error: null, ok: false });

    const theme_json = {
      brandName: s.brandName,
      primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor,
      logoUrl: s.logoUrl,
    };

    const res = await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: s.name,
        active: s.active,
        theme_json,
      }),
    });

    const json = await res.json();

    if (json?.ok) {
      updateEdit(id, { saving: false, ok: true, error: null });
      await load();
      return;
    }

    updateEdit(id, {
      saving: false,
      ok: false,
      error: json?.message || json?.error || "Save failed.",
    });
  }

  React.useEffect(() => {
    loadWhoAmI();
  }, []);

  React.useEffect(() => {
    if (!authLoading) {
      load();
    }
  }, [authLoading]);

  const canWrite = canWriteTenantsEmail(authedEmail);

  return (
    <div className="p-6 space-y-6 text-neutral-100">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Tenants</div>
          <div className="text-xs text-neutral-400">
            Manage tenant records + theme. Default tenant = core host.
          </div>
        </div>
        <button
          className="text-xs px-3 py-2 rounded border border-neutral-700 hover:bg-neutral-900"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      <div className="border border-neutral-800 p-4 rounded space-y-3">
        <div className="text-sm font-semibold text-neutral-200">Create Tenant</div>

        {!canWrite ? (
          <div className="text-xs text-amber-300/90">Tenant creation is owner-restricted for now.</div>
        ) : null}

        <div className="space-y-2">
          <input
            className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
            placeholder="Company Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canWrite}
          />
          <input
            className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
            placeholder="Slug (acme)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!canWrite}
          />

          <div className="flex items-center gap-3">
            <button
              className="bg-blue-600 px-3 py-2 rounded text-sm disabled:opacity-50"
              onClick={createTenant}
              disabled={!canWrite}
            >
              Create
            </button>
            {createError ? <span className="text-xs text-red-400">{createError}</span> : null}
          </div>

          {createdCreds ? (
            <div className="w-full rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200 space-y-1">
              <div className="font-semibold text-emerald-100">Tenant admin created</div>
              <div>
                <span className="text-emerald-200/80">Login URL:</span>{" "}
                <a
                  className="underline"
                  href={`https://${tenantHostForSlug(createdCreds.slug)}/login`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {`https://${tenantHostForSlug(createdCreds.slug)}/login`}
                </a>
              </div>
              <div>
                <span className="text-emerald-200/80">Email:</span>{" "}
                <span className="font-mono">{createdCreds.admin_email}</span>
              </div>
              <div>
                <span className="text-emerald-200/80">Temp password (copy now):</span>{" "}
                <span className="font-mono">{createdCreds.temp_password}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {tenants.map((t) => {
          const s = edit[t.id];
          const adminUrl = tenantAdminUrl(t.slug);
          const landingUrl = tenantLandingUrl(t.slug);
          const displayHost = tenantDisplayHost(t.slug);
          const th = themeOf(t);

          const primary = safeCssColor(th.primaryColor, "#111827"); // slate-900
          const secondary = safeCssColor(th.secondaryColor, "#0b1220"); // deep fallback

          return (
            <div key={t.id} className="border border-neutral-800 rounded overflow-hidden">
              {/* Theme preview band */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{
                  background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-white/90">{th.brandName || t.name}</div>
                  <div className="text-[10px] text-white/70 font-mono">
                    {t.slug} · #{t.id}
                  </div>
                </div>

                <div className="text-[10px] text-white/75 font-mono">{displayHost}</div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">
                      {t.name} <span className="text-xs text-neutral-500">({t.slug})</span>
                    </div>
                    <div className="text-xs text-neutral-400">
                      Host: <span className="font-mono">{displayHost}</span>
                    </div>
                    <div className="text-xs text-neutral-400">
                      <a className="underline" href={landingUrl} target="_blank" rel="noreferrer">
                        Open Site
                      </a>{" "}
                      ·{" "}
                      <a className="underline" href={adminUrl} target="_blank" rel="noreferrer">
                        Open Admin
                      </a>
                    </div>
                  </div>

                  <div className="text-right text-xs text-neutral-500">
                    {t.created_at ? new Date(t.created_at).toLocaleString() : null}
                  </div>
                </div>

                {s ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-400">Tenant name</div>
                      <input
                        className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                        value={s.name}
                        onChange={(e) => updateEdit(t.id, { name: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-xs text-neutral-300">
                        <input
                          type="checkbox"
                          checked={s.active}
                          onChange={(e) => updateEdit(t.id, { active: e.target.checked })}
                        />
                        Active
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-neutral-400">Theme</div>
                      <input
                        className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                        placeholder="brandName"
                        value={s.brandName}
                        onChange={(e) => updateEdit(t.id, { brandName: e.target.value })}
                      />
                      <input
                        className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                        placeholder="primaryColor (#0ea5e9)"
                        value={s.primaryColor}
                        onChange={(e) => updateEdit(t.id, { primaryColor: e.target.value })}
                      />
                      <input
                        className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                        placeholder="secondaryColor (#22c55e)"
                        value={s.secondaryColor}
                        onChange={(e) => updateEdit(t.id, { secondaryColor: e.target.value })}
                      />
                      <input
                        className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                        placeholder="logoUrl"
                        value={s.logoUrl}
                        onChange={(e) => updateEdit(t.id, { logoUrl: e.target.value })}
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        className="bg-emerald-600 px-3 py-2 rounded text-sm disabled:opacity-50"
                        onClick={() => saveTenant(t.id)}
                        disabled={s.saving}
                      >
                        {s.saving ? "Saving..." : "Save"}
                      </button>

                      {s.ok ? <span className="text-xs text-emerald-400">Saved.</span> : null}
                      {s.error ? <span className="text-xs text-red-400">{s.error}</span> : null}
                    </div>

                    <div className="text-xs text-neutral-500 md:col-span-2">
                      Current:{" "}
                      <span className="font-mono">
                        brandName={th.brandName || "(none)"} · primaryColor={th.primaryColor || "(none)"} ·
                        secondaryColor={th.secondaryColor || "(none)"} · logoUrl={th.logoUrl || "(none)"}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}