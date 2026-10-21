// components/admin/SystemHealthCards.tsx
//
// Step 38D: the Database, HubSpot and Email (Graph) health cards, moved
// unchanged from the admin Home to the owner-only Alex-IO → System health
// page (/admin/system-health). Same /api/health/* endpoints and deep checks.

"use client";

import * as React from "react";

type HealthResponse = {
  ok: boolean;
  status: string;
  detail?: string;
  message?: string;
  latency_ms?: number;
  configured?: boolean;
  missing_env?: string[];
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

export default function SystemHealthCards() {
  const dbHealth = useHealth("/api/health/db");
  const hubspotHealth = useHealth("/api/health/hubspot");
  const emailHealth = useHealth("/api/health/email");
  return (
    <div className="grid gap-4 md:grid-cols-3" data-system-health>
      <HealthCard
        title="Database"
        description="Core Postgres connection used by quotes, materials, and layouts."
        state={dbHealth}
        flavor="db"
      />
      <HealthCard
        title="HubSpot"
        description="Conversations & CRM integration driving inbound quote requests."
        state={hubspotHealth}
        flavor="hubspot"
      />
      <HealthCard
        title="Email (Graph)"
        description="Outbound quote replies from the dedicated alex-io.com mailbox."
        state={emailHealth}
        flavor="email"
      />
    </div>
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
