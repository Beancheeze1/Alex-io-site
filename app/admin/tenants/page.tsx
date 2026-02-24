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

export default function TenantsPage() {
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);

  const [edit, setEdit] = React.useState<Record<number, EditState>>({});

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
    load();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <button
          className="text-xs text-neutral-400 hover:text-neutral-200"
          onClick={load}
        >
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
            <button
              className="bg-blue-600 px-3 py-2 rounded text-sm"
              onClick={createTenant}
            >
              Create
            </button>
            {createError ? (
              <span className="text-xs text-red-400">{createError}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {tenants.map((t) => {
          const s = edit[t.id];
          const tenantUrl = `https://${t.slug}.api.alex-io.com`;
          return (
            <div
              key={t.id}
              className="border border-neutral-800 p-4 rounded space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-neutral-400">{t.slug}.api.alex-io.com</div>
                  <div className="text-[11px] text-neutral-500">ID: {t.id}</div>
                </div>

                <a
                  className="text-xs text-neutral-300 underline hover:text-neutral-100"
                  href={tenantUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open tenant
                </a>
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
                      <span className="text-neutral-200">
                        {s.active ? "Enabled" : "Disabled"}
                      </span>
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
                      onChange={(e) =>
                        updateEdit(t.id, { secondaryColor: e.target.value })
                      }
                      placeholder="#1E90FF"
                    />
                  </div>

                  <div className="md:col-span-2 flex items-center gap-3">
                    <button
                      className="bg-neutral-200 text-neutral-950 px-3 py-2 rounded text-sm disabled:opacity-60"
                      disabled={s.saving}
                      onClick={() => saveTenant(t.id)}
                    >
                      {s.saving ? "Saving..." : "Save"}
                    </button>

                    {s.ok ? (
                      <span className="text-xs text-green-400">Saved.</span>
                    ) : null}

                    {s.error ? (
                      <span className="text-xs text-red-400">{s.error}</span>
                    ) : null}
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