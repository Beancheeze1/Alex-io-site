"use client";

import * as React from "react";

type Tenant = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  theme_json: any;
  plan?: string | null;
  created_at?: string;
};

type EditState = {
  name: string;
  active: boolean;
  plan: string;
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  landingChatEnabled: boolean;
  heroUseLogo: boolean;
  tagline: string;
  websiteUrl: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  specsEmail: string;
  heroImageUrl: string;
  heroCaption: string;
  quoteScope: string;
  quoteIntro: string;
  aboutText: string;
  products: string[];
  stats: { label: string; value: string }[];
  saving: boolean;
  error: string | null;
  ok: boolean;
};

function getThemeField(theme: any, key: string): string {
  const v = theme?.[key];
  return typeof v === "string" ? v : "";
}

function getThemeBool(theme: any, key: string): boolean {
  return theme?.[key] === true;
}

// ---- Quote center page (/t/[tenant]) fields — stored in theme_json ----
const PAGE_INPUT_FIELDS = [
  "tagline",
  "websiteUrl",
  "phone",
  "email",
  "address",
  "hours",
  "specsEmail",
  "heroImageUrl",
  "heroCaption",
  "quoteScope",
] as const;
const PAGE_TEXTAREA_FIELDS = ["quoteIntro", "aboutText"] as const;
type PageTextField = (typeof PAGE_INPUT_FIELDS)[number] | (typeof PAGE_TEXTAREA_FIELDS)[number];
const PAGE_TEXT_FIELDS: readonly PageTextField[] = [...PAGE_INPUT_FIELDS, ...PAGE_TEXTAREA_FIELDS];

const PAGE_FIELD_LABELS: Record<PageTextField, string> = {
  tagline: "Tagline (under the name, e.g. Family-owned box makers since 1971)",
  websiteUrl: "Main website URL (https://…)",
  phone: "Phone",
  email: "Public contact email",
  address: "Plant address",
  hours: "Hours (e.g. Mon–Fri, 7:00 am – 4:30 pm)",
  specsEmail: "Spec request notifications go to (blank = public contact email)",
  heroImageUrl: "Banner photo URL (https://…, plant or shop floor)",
  heroCaption: "Banner photo caption (e.g. Our Wooster, Ohio plant)",
  quoteScope: "What buyers can quote online (e.g. standard box styles and mailers)",
  quoteIntro: "Banner intro sentence (blank = automatic)",
  aboutText: "About text (2–3 sentences: how you started, what you do today)",
};

const PRODUCT_OPTIONS: { key: string; label: string }[] = [
  { key: "rsc", label: "Corrugated boxes" },
  { key: "printed", label: "Printed packaging" },
  { key: "mailer", label: "Die-cut mailers" },
  { key: "foam", label: "Foam inserts" },
  { key: "kit", label: "Foam-in-box kits" },
];

function getThemeProducts(theme: any): string[] {
  const v = theme?.products;
  if (!Array.isArray(v)) return [];
  const allowed = new Set(PRODUCT_OPTIONS.map((p) => p.key));
  return v.filter((k: unknown): k is string => typeof k === "string" && allowed.has(k));
}

function getThemeStats(theme: any): { label: string; value: string }[] {
  const v = Array.isArray(theme?.stats) ? theme.stats : [];
  const rows = v.slice(0, 4).map((s: any) => ({
    label: typeof s?.label === "string" ? s.label : "",
    value: typeof s?.value === "string" ? s.value : "",
  }));
  while (rows.length < 4) rows.push({ label: "", value: "" });
  return rows;
}

function pagePatch(k: PageTextField, v: string): Partial<EditState> {
  const p: Partial<EditState> = {};
  p[k] = v;
  return p;
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
      typeof th?.brandName === "string" && th.brandName.trim()
        ? th.brandName.trim()
        : "",
    primaryColor:
      typeof th?.primaryColor === "string" && th.primaryColor.trim()
        ? th.primaryColor.trim()
        : "",
    secondaryColor:
      typeof th?.secondaryColor === "string" && th.secondaryColor.trim()
        ? th.secondaryColor.trim()
        : "",
    logoUrl:
      typeof th?.logoUrl === "string" && th.logoUrl.trim()
        ? th.logoUrl.trim()
        : "",
    heroUseLogo: th?.heroUseLogo === true,
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
  const [domain, setDomain] = React.useState(""); // NEW
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = React.useState<{
    slug: string;
    admin_email: string;
    temp_password: string;
  } | null>(null);

  async function loadWhoAmI() {
    try {
      const res = await fetch(`/api/auth/whoami?t=${Math.random()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      const email =
        json?.ok && json?.authenticated && json?.user?.email
          ? String(json.user.email)
          : null;
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
              plan: t.plan || "pro",
              brandName: getThemeField(t.theme_json, "brandName"),
              primaryColor: getThemeField(t.theme_json, "primaryColor"),
              secondaryColor: getThemeField(t.theme_json, "secondaryColor"),
              logoUrl: getThemeField(t.theme_json, "logoUrl"),
              landingChatEnabled: getThemeBool(
                t.theme_json,
                "landingChatEnabled",
              ),
              heroUseLogo: getThemeBool(t.theme_json, "heroUseLogo"),
              ...(Object.fromEntries(
                PAGE_TEXT_FIELDS.map((k) => [k, getThemeField(t.theme_json, k)]),
              ) as Record<PageTextField, string>),
              products: getThemeProducts(t.theme_json),
              stats: getThemeStats(t.theme_json),
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
      body: JSON.stringify({
        name,
        slug,
        domain: domain.trim(), // NEW (domain-only)
      }),
    });

    const json = await res.json();
    if (json?.ok) {
      setName("");
      setSlug("");
      setDomain(""); // NEW
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

    // Merge onto the tenant's existing theme_json so keys this form doesn't
    // edit are preserved. (Previously the whole object was replaced with six
    // keys, silently deleting anything else stored in theme_json.)
    const existing = tenants.find((x) => x.id === id)?.theme_json;
    const existingTheme =
      existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};

    const pageFields = Object.fromEntries(
      PAGE_TEXT_FIELDS.map((k) => [k, String(s[k] || "").trim()]),
    );

    const theme_json = {
      ...existingTheme,
      brandName: s.brandName,
      primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor,
      logoUrl: s.logoUrl,
      landingChatEnabled: !!s.landingChatEnabled,
      heroUseLogo: !!s.heroUseLogo,
      ...pageFields,
      products: s.products,
      stats: s.stats
        .map((st) => ({ label: st.label.trim(), value: st.value.trim() }))
        .filter((st) => st.label && st.value)
        .slice(0, 4),
    };

    const res = await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: s.name,
        active: s.active,
        plan: s.plan, // was never sent before — the plan dropdown silently didn't save
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
    <div className="p-6 space-y-6 text-[var(--text-primary)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-medium">Tenants</div>
          <div className="text-xs text-[var(--text-muted)]">
            Manage tenant records + theme. Default tenant = core host.
          </div>
        </div>
        <button
          className="text-xs px-3 py-2 rounded border border-[var(--border)] hover:bg-[var(--surface-subtle)]"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      <div className="border border-[var(--border)] p-4 rounded space-y-3">
        <div className="text-sm font-medium text-[var(--text-primary)]">Create Tenant</div>

        {!canWrite ? (
          <div className="text-xs text-[var(--attention)]">
            Tenant creation is owner-restricted for now.
          </div>
        ) : null}

        <div className="space-y-2">
          <input
            className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
            placeholder="Company Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canWrite}
          />
          <input
            className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
            placeholder="Slug (acme)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!canWrite}
          />

          {/* NEW: domain-only brand pull */}
          <input
            className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
            placeholder="Domain for brand pull (acme.com)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={!canWrite}
          />
          <div className="text-[11px] text-[var(--text-faint)]">
            Optional. If provided, we’ll try to pull theme-color + logo from the
            homepage.
          </div>

          <div className="flex items-center gap-3">
            <button
              className="bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] text-white px-3 py-2 rounded text-sm disabled:opacity-50"
              onClick={createTenant}
              disabled={!canWrite}
            >
              Create
            </button>
            {createError ? (
              <span className="text-xs text-[var(--attention)]">{createError}</span>
            ) : null}
          </div>

          {createdCreds ? (
            <div className="w-full rounded border border-[var(--status-success-text)]/30 bg-[var(--status-success-bg)] p-3 text-xs text-[var(--status-success-text)] space-y-1">
              <div className="font-medium text-[var(--status-success-text)]">
                Tenant admin created
              </div>
              <div>
                <span className="text-[var(--status-success-text)]/80">Login URL:</span>{" "}
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
                <span className="text-[var(--status-success-text)]/80">Email:</span>{" "}
                <span className="font-mono">{createdCreds.admin_email}</span>
              </div>
              <div>
                <span className="text-[var(--status-success-text)]/80">
                  Temp password (copy now):
                </span>{" "}
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

          const primary = safeCssColor(th.primaryColor, "var(--text-primary)");
          const secondary = safeCssColor(th.secondaryColor, "var(--text-secondary)");

          return (
            <div key={t.id} className="border border-[var(--border)] rounded overflow-hidden">
              {/* Theme preview band */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{
                  background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-white/90">
                    {th.brandName || t.name}
                  </div>
                  <div className="text-[10px] text-white/70 font-mono">
                    {t.slug} · #{t.id}
                  </div>
                </div>

                <div className="text-[10px] text-white/75 font-mono">
                  {displayHost}
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {t.name}{" "}
                      <span className="text-xs text-[var(--text-faint)]">
                        ({t.slug})
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Host: <span className="font-mono">{displayHost}</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      <a className="text-[var(--text-secondary)] underline" href={landingUrl} target="_blank" rel="noreferrer">
                        Open Site
                      </a>{" "}
                      ·{" "}
                      <a className="text-[var(--text-secondary)] underline" href={adminUrl} target="_blank" rel="noreferrer">
                        Open Admin
                      </a>
                    </div>
                  </div>

                  <div className="text-right text-xs text-[var(--text-faint)]">
                    {t.created_at ? new Date(t.created_at).toLocaleString() : null}
                  </div>
                </div>

                {s ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div className="text-xs text-[var(--text-muted)]">Tenant name</div>
                      <input
                        className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                        value={s.name}
                        onChange={(e) => updateEdit(t.id, { name: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={s.active}
                          onChange={(e) => updateEdit(t.id, { active: e.target.checked })}
                        />
                        Active
                      </label>

                      {/* Plan tier selector */}
                      <div className="space-y-1 pt-1">
                        <div className="text-xs text-[var(--text-muted)]">Subscription plan</div>
                        <select
                          className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-sm text-[var(--text-primary)]"
                          value={s.plan}
                          onChange={(e) => updateEdit(t.id, { plan: e.target.value })}
                        >
                          <option value="starter">Starter — $799/mo · 2 seats · PDF only</option>
                          <option value="pro">Pro — $1,299/mo · 10 seats · CAD + HubSpot</option>
                          <option value="shop">Shop — $1,999/mo · Unlimited · Multi-location</option>
                        </select>
                        <div className="text-[10px] text-[var(--text-faint)]">
                          {s.plan === "starter" && "No CAD exports · No HubSpot sync · No commissions · 2 seat max"}
                          {s.plan === "pro" && "CAD/DXF/STEP exports · HubSpot sync · Commission tracking · 10 seat max"}
                          {s.plan === "shop" && "All Pro features · Multi-location · White-label · API · Unlimited seats"}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-[var(--text-muted)]">Theme</div>
                      <input
                        className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                        placeholder="brandName"
                        value={s.brandName}
                        onChange={(e) => updateEdit(t.id, { brandName: e.target.value })}
                      />
                      <input
                        className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                        placeholder="primaryColor (#0ea5e9)"
                        value={s.primaryColor}
                        onChange={(e) => updateEdit(t.id, { primaryColor: e.target.value })}
                      />
                      <input
                        className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                        placeholder="secondaryColor (#22c55e)"
                        value={s.secondaryColor}
                        onChange={(e) => updateEdit(t.id, { secondaryColor: e.target.value })}
                      />
                      <input
                        className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                        placeholder="logoUrl"
                        value={s.logoUrl}
                        onChange={(e) => updateEdit(t.id, { logoUrl: e.target.value })}
                      />

                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!!s.landingChatEnabled}
                          onChange={(e) =>
                            updateEdit(t.id, {
                              landingChatEnabled: e.target.checked,
                            })
                          }
                        />
                        Show chat on landing page
                      </label>

                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!!s.heroUseLogo}
                          onChange={(e) => updateEdit(t.id, { heroUseLogo: e.target.checked })}
                        />
                        Use logo on landing page (instead of text)
                      </label>

                      <div className="text-[11px] text-[var(--text-faint)]">
                        If enabled, landing page uses logoUrl. If missing/broken, it falls back to text.
                      </div>
                    </div>

                    <div className="space-y-3 md:col-span-2 border-t border-[var(--border)] pt-4">
                      <div>
                        <div className="text-sm font-medium">Quote center page</div>
                        <div className="text-[11px] text-[var(--text-faint)]">
                          Shown at /t/{t.slug}. Leave a field blank to hide it. Links and images must start with https://.
                          Uses primaryColor for buttons and secondaryColor for the top bar, banner (when no photo) and footer.
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {PAGE_INPUT_FIELDS.map((k) => (
                          <label key={k} className="block space-y-1 text-xs text-[var(--text-muted)]">
                            <span>{PAGE_FIELD_LABELS[k]}</span>
                            <input
                              className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                              value={s[k]}
                              onChange={(e) =>
                                updateEdit(t.id, pagePatch(k, e.target.value))
                              }
                            />
                          </label>
                        ))}
                      </div>

                      {PAGE_TEXTAREA_FIELDS.map((k) => (
                        <label key={k} className="block space-y-1 text-xs text-[var(--text-muted)]">
                          <span>{PAGE_FIELD_LABELS[k]}</span>
                          <textarea
                            rows={3}
                            className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                            value={s[k]}
                            onChange={(e) =>
                              updateEdit(t.id, pagePatch(k, e.target.value))
                            }
                          />
                        </label>
                      ))}

                      <div className="space-y-1">
                        <div className="text-xs text-[var(--text-muted)]">Products shown under “What you can quote online”</div>
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {PRODUCT_OPTIONS.map((p) => (
                            <label key={p.key} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                              <input
                                type="checkbox"
                                checked={s.products.includes(p.key)}
                                onChange={(e) =>
                                  updateEdit(t.id, {
                                    products: e.target.checked
                                      ? [...s.products.filter((x) => x !== p.key), p.key]
                                      : s.products.filter((x) => x !== p.key),
                                  })
                                }
                              />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs text-[var(--text-muted)]">
                          Stats (up to 4; a row needs both a value and a label to show)
                        </div>
                        {s.stats.map((st, i) => (
                          <div key={i} className="grid grid-cols-2 gap-2">
                            <input
                              className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                              placeholder="Value (e.g. 1971)"
                              value={st.value}
                              onChange={(e) =>
                                updateEdit(t.id, {
                                  stats: s.stats.map((row, j) =>
                                    j === i ? { ...row, value: e.target.value } : row,
                                  ),
                                })
                              }
                            />
                            <input
                              className="bg-[var(--surface-card)] p-2 w-full rounded border border-[var(--border)] text-[var(--text-primary)]"
                              placeholder="Label (e.g. Founded)"
                              value={st.label}
                              onChange={(e) =>
                                updateEdit(t.id, {
                                  stats: s.stats.map((row, j) =>
                                    j === i ? { ...row, label: e.target.value } : row,
                                  ),
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        className="bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                        onClick={() => saveTenant(t.id)}
                        disabled={s.saving}
                      >
                        {s.saving ? "Saving..." : "Save"}
                      </button>

                      {s.ok ? <span className="text-xs text-[var(--status-success-text)]">Saved.</span> : null}
                      {s.error ? <span className="text-xs text-[var(--attention)]">{s.error}</span> : null}
                    </div>

                    <div className="text-xs text-[var(--text-faint)] md:col-span-2">
                      Current:{" "}
                      <span className="font-mono">
                        brandName={th.brandName || "(none)"} · primaryColor={th.primaryColor || "(none)"} ·
                        secondaryColor={th.secondaryColor || "(none)"} · logoUrl={th.logoUrl || "(none)"} ·
                        heroUseLogo={th.heroUseLogo ? "true" : "false"} Â· landingChatEnabled=
                        {t.theme_json?.landingChatEnabled === true ? "true" : "false"}
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
