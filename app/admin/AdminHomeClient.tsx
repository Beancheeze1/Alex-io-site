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
  tenantSlug: string | null;
  landingChatEnabled: boolean;
  /** Step 38A2: foam cards only for foam shops, corrugated for box shops. */
  sellsFoam?: boolean;
  sellsBoxes?: boolean;
  /** Step 38A2: System Health is the platform owner's, not the shop's. */
  isOwner?: boolean;
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
  shipping_cap_usd?: number;
  source?: "db" | "default";
  error?: string;
  message?: string;
};

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

export default function AdminHomeClient({ dashboardTitle, tenantSlug, landingChatEnabled, sellsFoam = true, sellsBoxes = true, isOwner = false }: AdminHomeClientProps) {
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

  // Step 36A: "Finish setting up" banner until the Get started checklist is complete.
  const [setup, setSetup] = React.useState<{ done: number; total: number } | null>(null);
  React.useEffect(() => {
    let active = true;
    fetch("/api/admin/onboarding", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.ok && j.checklist && !j.checklist.complete) setSetup({ done: Number(j.checklist.done), total: Number(j.checklist.total) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
            Your quotes, pricing, team and shop settings.
          </p>
        </header>

        {setup ? (
          <Link
            href="/admin/get-started"
            className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--action-primary)] bg-[var(--surface-card)] px-4 py-3 text-sm"
            data-setup-banner
          >
            <span className="font-medium text-[var(--text-primary)]">Finish setting up your shop</span>
            <span className="text-[var(--text-secondary)]">
              {setup.done} of {setup.total} done
            </span>
            <span className="ml-auto font-medium text-[var(--action-primary)]">Get started →</span>
          </Link>
        ) : null}

        {/* System health row (Step 38A2: platform owner only) */}
        {isOwner ? (
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

        ) : null}

        {/* Main navigation tiles */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Shortcuts
          </h2>

          {/* Step 38A2: only what this shop sells; same names as the menu */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <NavCard
              href="/admin/quotes"
              title="Quotes"
              description="Every quote: status, buyer, totals. Open one to revise, release or print the job ticket."
            />
            <NavCard
              href="/admin/review"
              title="Review queue"
              description="New quotes, accepted orders waiting for you to confirm, proofs and price changes."
            />
            {sellsBoxes ? (
              <NavCard
                href="/admin/corrugated"
                title="Corrugated boxes"
                description="Board grades and $/MSF, run and print rates, box styles, scoring and a price check."
              />
            ) : null}
            {sellsFoam ? (
              <NavCard
                href="/admin/materials"
                title="Foam materials"
                description="Your price per cubic inch, minimum charge and waste for each foam."
              />
            ) : null}
            {sellsFoam ? (
              <NavCard
                href="/admin/cushion-curves"
                title="Cushion curves"
                description="Cushion data behind the foam advisor's recommendations."
              />
            ) : null}
            {sellsFoam ? (
              <NavCard
                href="/admin/boxes"
                title="Stock cartons"
                description="Stock carton sizes and price tiers offered with foam quotes."
              />
            ) : null}
            <NavCard
              href="/admin/settings#freight"
              title="Freight & shipping"
              description="Ship-from ZIP, freight terms and the rate table used on every quote."
            />
            <NavCard
              href="/admin/commissions"
              title="Commissions"
              description="Sales rep commission rates, quote totals and payouts."
            />
          </div>
        </section>

        {/* Rough shipping estimate knob - moved under Admin Areas */}
        <section className="mb-10 scroll-mt-16" id="shipping">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Rough Shipping Estimate
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ShippingSettingsCard />
          </div>
        </section>

        {/* Embeddable widget snippet generator (Step 38A: menu Shop settings → Website & chat widget) */}
        <section className="mb-10 scroll-mt-16" id="widget">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Embeddable Widget
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <EmbedSnippetCard tenantSlug={tenantSlug} landingChatEnabled={landingChatEnabled} />
          </div>
        </section>

        {/* Step 38B: users moved to their own page, /admin/team (Shop settings → Team & users) */}
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
  const [capValue, setCapValue] = React.useState<string>("");
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
        const cap = json.shipping_cap_usd ?? 200.0;
        setValue(String(pct));
        setCapValue(String(cap));
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

    const capN = Number(capValue);
    if (!Number.isFinite(capN) || capN < 0) {
      setError("Please enter a valid shipping cap ($, 0 or more).");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/shipping-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rough_ship_pct: n, shipping_cap_usd: capN }),
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
        setSavedMessage("Saved – new rough shipping % and cap are live.");
        setError(null);
        const pct = json.rough_ship_pct ?? n;
        const cap = json.shipping_cap_usd ?? capN;
        setValue(String(pct));
        setCapValue(String(cap));
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
        as a percentage of the order subtotal. Used only when freight isn&apos;t set up (no ship-from ZIP).
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
              Rough shipping (% of the order)
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
            <label className="text-xs text-[var(--text-secondary)]">
              Shipping cap ($ max)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">$</span>
            <input
              type="number"
              step="1"
              min={0}
              value={capValue}
              onChange={(e) => setCapValue(e.target.value)}
              disabled={disabled}
              className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-[var(--action-primary)]/30 focus:border-[var(--action-primary)] focus:ring-1 disabled:opacity-60"
            />
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            If the computed rough shipping estimate exceeds this amount, the cap is shown instead.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={disabled}
              className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save shipping settings"}
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

// ---------- Embeddable widget snippet generator ----------

type EmbedMode = "quote-form" | "quote-viewer" | "chat";

function buildEmbedHost(slug: string): string {
  // "default" is the core/root tenant slug (no subdomain prefix) — same
  // convention used by lib/tenant.ts for resolving the core host.
  return slug === "default" ? "api.alex-io.com" : `${slug}.api.alex-io.com`;
}

function buildEmbedSnippet(slug: string, mode: EmbedMode): string {
  if (mode === "chat") {
    // No placeholder div — chat floats independent of document flow,
    // corner-pinned by embed.js itself. Tenant comes from the script tag's
    // own data-tenant attribute.
    return `<script src="https://api.alex-io.com/embed.js" data-alexio-chat data-tenant="${slug}" async></script>`;
  }

  const dataAttrs =
    mode === "quote-viewer"
      ? `data-alexio-embed data-tenant="${slug}" data-mode="quote-viewer" data-quote-no="PASTE-QUOTE-NUMBER-HERE"`
      : `data-alexio-embed data-tenant="${slug}" data-mode="quote-form"`;

  return [
    `<div ${dataAttrs}></div>`,
    `<script src="https://api.alex-io.com/embed.js" async></script>`,
  ].join("\n");
}

function EmbedSnippetCard({
  tenantSlug,
  landingChatEnabled,
}: {
  tenantSlug: string | null;
  landingChatEnabled: boolean;
}) {
  const [mode, setMode] = React.useState<EmbedMode>("quote-form");
  const [copied, setCopied] = React.useState(false);

  const snippet = tenantSlug ? buildEmbedSnippet(tenantSlug, mode) : "";

  async function handleCopy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Embed snippet
        </div>
        {tenantSlug && (
          <span className="inline-flex items-center rounded-full bg-[var(--status-neutral-bg)] px-2 py-0.5 text-[10px] text-[var(--status-neutral-text)]">
            {buildEmbedHost(tenantSlug)}
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        Paste this snippet into any page on your own website to embed the quote form or
        interactive quote viewer inline.
      </p>

      {!tenantSlug ? (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Could not resolve your tenant — reload this page to try again.
        </p>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("quote-form")}
              className={[
                "rounded-full px-3 py-1 text-[11px] font-medium",
                mode === "quote-form"
                  ? "bg-[var(--action-primary)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              Quote form
            </button>
            <button
              type="button"
              onClick={() => setMode("quote-viewer")}
              className={[
                "rounded-full px-3 py-1 text-[11px] font-medium",
                mode === "quote-viewer"
                  ? "bg-[var(--action-primary)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              Quote viewer
            </button>
            <button
              type="button"
              onClick={() => landingChatEnabled && setMode("chat")}
              disabled={!landingChatEnabled}
              title={landingChatEnabled ? undefined : "Enable landing chat for this tenant first (owner-managed, /admin/tenants)."}
              className={[
                "rounded-full px-3 py-1 text-[11px] font-medium",
                !landingChatEnabled
                  ? "cursor-not-allowed border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-faint)] opacity-60"
                  : mode === "chat"
                    ? "bg-[var(--action-primary)] text-white"
                    : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              Chat
            </button>
          </div>

          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--border)] bg-[var(--surface-page)] p-3 text-[11px] leading-relaxed text-[var(--text-primary)]">
            {snippet}
          </pre>

          {mode === "quote-viewer" && (
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Replace <code>PASTE-QUOTE-NUMBER-HERE</code> with the real quote number you want to
              display (e.g. from a customer&apos;s emailed quote link).
            </p>
          )}

          {mode === "chat" && landingChatEnabled && (
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              No placeholder div needed — this floats as a corner bubble on your site and expands
              into the quote form itself once a visitor finishes the guided chat.
            </p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)]"
            >
              Copy to clipboard
            </button>
            {copied && (
              <span className="text-[11px] text-[var(--status-success-text)]">Copied!</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
