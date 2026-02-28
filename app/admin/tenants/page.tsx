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

function tenantHostForSlug(slug: string): string {
  // Example: current host is api.alex-io.com or default.api.alex-io.com
  // We want: <slug>.api.alex-io.com (or <slug>.alex-io.com if base changes later)
  const host =
    typeof window !== "undefined" && window.location && window.location.host
      ? window.location.host
      : "api.alex-io.com";

  const parts = host.split(".");
  // If host already includes a tenant subdomain, strip it (keep last 3 labels: api.alex-io.com)
  const base =
    parts.length >= 3 ? parts.slice(-3).join(".") : host;

  return `${slug}.${base}`;
}

function tenantAdminUrl(slug: string): string {
  return `https://${tenantHostForSlug(slug)}/admin`;
}

function tenantRootUrl(slug: string): string {
  return `https://${tenantHostForSlug(slug)}`;
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

// Owner-only tenant admin allowlist (UI)
const TENANT_WRITE_EMAIL_ALLOWLIST = new Set<string>([
  "25thhourdesign@gmail.com",
]);

function canWriteTenantsEmail(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  return TENANT_WRITE_EMAIL_ALLOWLIST.has(e);
}

export default function TenantsPage() {
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);

  const [edit, setEdit] = React.useState<Record<number, EditState>>({});

  const [authLoading, setAuthLoading] = React.useState(true);
  const [authedEmail, setAuthedEmail] = React.useState<string | null>(null);

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

    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    });

    const json = await res.json();
    if (json?.ok) {
      setName("");
      setSlug("");
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

  if (authLoading) {
    return (
      <div className="p-6">
        <div className="text-sm text-neutral-300">Loading…</div>
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <div className="rounded border border-neutral-800 bg-neutral-950 p-4">
          <div className="text-sm font-semibold text-neutral-200">Restricted</div>
          <div className="mt-1 text-sm text-neutral-400">
            Tenant management is restricted to the owner.
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            Signed in as: <span className="font-mono">{authedEmail || "unknown"}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="border border-neutral-800 p-4 rounded space-y-3">
        <div className="text-sm font-semibold text-neutral-200">Create Tenant</div>
        <div className="space-y-2">
          <input
            className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
            placeholder="Company Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
            placeholder="Slug (acme)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button className="bg-blue-600 px-3 py-2 rounded text-sm" onClick={createTenant}>
              Create
            </button>
            {createError ? <span className="text-xs text-red-400">{createError}</span> : null}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {tenants.map((t) => {
          const s = edit[t.id];
          const adminUrl = tenantAdminUrl(t.slug);
          const rootUrl = tenantRootUrl(t.slug);
          return (
            <div key={t.id} className="border border-neutral-800 p-4 rounded space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <a
                    className="text-xs text-neutral-300 underline hover:text-neutral-100"
                    href={adminUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this tenant's admin in a new tab"
                  >
                    {t.slug}.api.alex-io.com
                  </a>
                  <div className="text-[11px] text-neutral-500">ID: {t.id}</div>
                </div>

                <div className="flex items-center gap-3">
                  <a
                    className="text-xs text-neutral-300 underline hover:text-neutral-100"
                    href={adminUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open admin
                  </a>
                  <a
                    className="text-xs text-neutral-500 underline hover:text-neutral-200"
                    href={rootUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open site
                  </a>
                </div>
              </div>

              {!s ? null : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Company name</div>
                    <input
                      className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                      value={s.name}
                      onChange={(e) => updateEdit(t.id, { name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Active</div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.active}
                        onChange={(e) => updateEdit(t.id, { active: e.target.checked })}
                      />
                      <span className="text-neutral-200">{s.active ? "Enabled" : "Disabled"}</span>
                    </label>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Brand name (theme)</div>
                    <input
                      className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                      value={s.brandName}
                      onChange={(e) => updateEdit(t.id, { brandName: e.target.value })}
                      placeholder="Acme Packaging"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Logo URL</div>
                    <input
                      className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                      value={s.logoUrl}
                      onChange={(e) => updateEdit(t.id, { logoUrl: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Primary color</div>
                    <input
                      className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                      value={s.primaryColor}
                      onChange={(e) => updateEdit(t.id, { primaryColor: e.target.value })}
                      placeholder="#0A3D62"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Secondary color</div>
                    <input
                      className="bg-neutral-900 p-2 w-full rounded border border-neutral-800"
                      value={s.secondaryColor}
                      onChange={(e) => updateEdit(t.id, { secondaryColor: e.target.value })}
                      placeholder="#1E90FF"
                    />
                  </div>

                  {(() => {
                    const th = themeOf(t);
                    const brand = th.brandName || t.name || t.slug;
                    const primary = th.primaryColor || "#2563eb";
                    const secondary = th.secondaryColor || "#0ea5e9";

                    return (
                      <div className="mt-3 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Preview
                        </div>

                        <div
                          className="mt-2 rounded-xl border border-slate-800/80 px-3 py-2"
                          style={{
                            background: `linear-gradient(to right, ${primary}, ${secondary}, #0f172a)`,
                          }}
                        >
                          <div className="flex items-center gap-2">
                            {th.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={th.logoUrl}
                                alt="Tenant logo preview"
                                className="h-7 w-7 rounded bg-white/5 object-contain"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded bg-white/10" />
                            )}

                            <div className="text-sm font-extrabold text-slate-50">{brand}</div>

                            <div className="ml-auto flex items-center gap-1">
                              <span
                                className="h-4 w-4 rounded border border-white/20"
                                title={`primary: ${primary}`}
                                style={{ background: primary }}
                              />
                              <span
                                className="h-4 w-4 rounded border border-white/20"
                                title={`secondary: ${secondary}`}
                                style={{ background: secondary }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-slate-400">
                          Uses tenant theme_json (read-only preview)
                        </div>
                      </div>
                    );
                  })()}

                  <div className="md:col-span-2 flex items-center gap-3">
                    <button
                      className="bg-neutral-200 text-neutral-950 px-3 py-2 rounded text-sm disabled:opacity-60"
                      disabled={s.saving}
                      onClick={() => saveTenant(t.id)}
                    >
                      {s.saving ? "Saving..." : "Save"}
                    </button>

                    {s.ok ? <span className="text-xs text-green-400">Saved.</span> : null}

                    {s.error ? <span className="text-xs text-red-400">{s.error}</span> : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
