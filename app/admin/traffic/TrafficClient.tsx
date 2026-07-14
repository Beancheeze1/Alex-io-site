"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import type { TrafficData } from "./page";

// ssr: false — see DailyActivityChart.tsx for why the chart itself can't be
// server-rendered.
const DailyActivityChart = dynamic(() => import("./DailyActivityChart"), {
  ssr: false,
  loading: () => <div style={{ height: 240 }} />,
});

const FUNNEL_ORDER = [
  "page_view",
  "scroll_50",
  "cta_click",
  "form_start",
  "form_submit",
] as const;

// Muted funnel-stage palette (legitimate exception to the single-accent rule —
// a multi-series chart genuinely needs distinguishable hues). Desaturated from
// the original neon sky/indigo/orange/yellow/green so it reads as considered
// against the light design system rather than leftover dark-theme accents.
const FUNNEL_COLORS: Record<string, string> = {
  page_view:   "#4A9BC4",
  scroll_50:   "#7B7FD1",
  cta_click:   "#E08847",
  form_start:  "#D4A82F",
  form_submit: "#4FAD6E",
};

const FUNNEL_LABELS: Record<string, string> = {
  page_view:   "Page View",
  scroll_50:   "Scrolled 50%",
  cta_click:   "CTA Click",
  form_start:  "Form Start",
  form_submit: "Form Submit",
};

// Badge pairs: pale tint background + darker-shade text of the same muted hue
// (same treatment as --status-success-bg/text, applied per funnel category).
const BADGE_COLORS: Record<string, string> = {
  page_view:     "bg-[#E7F1F7] text-[#1F5A78]",
  scroll_50:     "bg-[#EAEAF9] text-[#3F3F8F]",
  cta_click:     "bg-[#FBEBDD] text-[#8A4D1D]",
  form_start:    "bg-[#FAF1D6] text-[#6B5310]",
  form_submit:   "bg-[#E6F4EA] text-[#2B6B3F]",
  sample_editor: "bg-[#EAEAF9] text-[#3F3F8F]",
  sample_skip:   "bg-[#FBEBDD] text-[#8A4D1D]",
  quote_applied: "bg-[var(--status-success-bg)] text-[var(--status-success-text)]",
  quote_email:   "bg-[var(--status-success-bg)] text-[var(--status-success-text)]",
};

const BADGE_LABELS: Record<string, string> = {
  page_view:     "page view",
  scroll_50:     "scrolled 50%",
  cta_click:     "CTA click",
  form_start:    "form start",
  form_submit:   "form submit",
  sample_editor: "tried editor",
  sample_skip:   "skipped to quote",
  quote_applied: "applied quote",
  quote_email:   "requested email",
};

const HIGH_INTENT = new Set(["quote_applied", "quote_email"]);

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-4">
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-semibold text-[var(--text-primary)]">
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {sub && <div className="text-xs text-[var(--text-faint)] mt-1">{sub}</div>}
    </div>
  );
}

type SortKey = "first_seen" | "last_seen" | "device" | "utm_source" | "events" | "converted" | "city";

const SESSION_COLS: { key: SortKey; label: string }[] = [
  { key: "first_seen",  label: "First Seen" },
  { key: "last_seen",   label: "Last Active" },
  { key: "device",      label: "Device" },
  { key: "city",        label: "Location" },
  { key: "utm_source",  label: "Source" },
  { key: "events",      label: "Events" },
  { key: "converted",   label: "Converted" },
];

export default function TrafficClient({ data }: { data: TrafficData }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filter, setFilter]   = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("last_seen");
  const [sortAsc, setSortAsc] = useState(false);

  const { days, funnel, daily, sources, sessions } = data;

  const funnelMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of funnel) m[r.event_type] = r.sessions;
    return m;
  }, [funnel]);

  const pageViews   = funnelMap["page_view"]   ?? 0;
  const ctaClicks   = funnelMap["cta_click"]   ?? 0;
  const formSubmits = funnelMap["form_submit"]  ?? 0;
  const scroll50    = funnelMap["scroll_50"]    ?? 0;
  const converted   = sessions.filter((s) => s.converted).length;

  function setDays(d: number) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("days", String(d));
    router.push(`?${p.toString()}`);
  }

  function toggleSort(col: SortKey) {
    if (sortCol === col) {
      setSortAsc((v) => !v);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  }

  const filteredSessions = useMemo(() => {
    const q = filter.toLowerCase();
    const filtered = sessions.filter(
      (s) =>
        !q ||
        s.session_id.includes(q) ||
        (s.device ?? "").toLowerCase().includes(q) ||
        (s.utm_source ?? "").toLowerCase().includes(q) ||
        (s.referrer ?? "").toLowerCase().includes(q) ||
        s.events.toLowerCase().includes(q),
    );

    filtered.sort((a, b) => {
      const av = String(a[sortCol] ?? "");
      const bv = String(b[sortCol] ?? "");
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });

    return filtered.slice(0, 100);
  }, [sessions, filter, sortCol, sortAsc]);

  return (
    <div className="space-y-8">
      {/* Header + day filter */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">Landing Traffic</h1>
        <div className="flex gap-2">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                days === d
                  ? "bg-[var(--action-primary)] text-white"
                  : "bg-[var(--surface-subtle)] text-[var(--text-muted)] hover:bg-[var(--surface-card)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Unique Visitors"    value={pageViews} />
        <KpiCard label="CTA Clicks"         value={ctaClicks}   sub={`${pct(ctaClicks, pageViews)} of visits`} />
        <KpiCard label="Demo Submissions"   value={formSubmits} sub={`${pct(formSubmits, pageViews)} conversion`} />
        <KpiCard label="Scrolled 50%"       value={scroll50}    sub={pct(scroll50, pageViews)} />
        <KpiCard label="Converted Sessions" value={converted} />
      </div>

      {/* Conversion funnel */}
      <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-5">
        <h2 className="text-sm font-medium text-[var(--text-primary)] mb-4">Conversion Funnel</h2>
        <div className="space-y-3">
          {FUNNEL_ORDER.map((et) => {
            const count = funnelMap[et] ?? 0;
            const width = pageViews ? Math.round((count / pageViews) * 100) : 0;
            return (
              <div key={et} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{FUNNEL_LABELS[et]}</div>
                <div className="flex-1 h-5 rounded bg-[var(--surface-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${width}%`,
                      backgroundColor: FUNNEL_COLORS[et],
                    }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right text-xs text-[var(--text-secondary)]">
                  {fmt(count)}{" "}
                  <span className="text-[var(--text-faint)]">({pct(count, pageViews)})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily activity chart */}
      <div
        className="rounded-xl border border-[var(--border)] p-5"
        style={{ backgroundColor: "#FFFFFF" }}
      >
        <h2 className="text-sm font-medium text-[var(--text-primary)] mb-4">Daily Activity</h2>
        <DailyActivityChart
          daily={daily}
          colors={{
            page_view: FUNNEL_COLORS.page_view,
            cta_click: FUNNEL_COLORS.cta_click,
            form_submit: FUNNEL_COLORS.form_submit,
          }}
        />
      </div>

      {/* Traffic sources table */}
      <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Traffic Sources</h2>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Source</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Sessions</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">CTA Clicks</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">CTA Rate</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Demo Subs</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Conv Rate</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3 text-[var(--text-primary)]">{s.source}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmt(s.sessions)}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmt(s.cta_clicks)}</td>
                <td className="px-4 py-3 text-right text-[var(--text-muted)]">{pct(s.cta_clicks, s.sessions)}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmt(s.form_submits)}</td>
                <td className="px-4 py-3 text-right text-[var(--text-muted)]">{pct(s.form_submits, s.sessions)}</td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-faint)]">
                  No data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent sessions table */}
      <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Recent Sessions
            <span className="ml-2 text-xs font-normal text-[var(--text-faint)]">
              ({filteredSessions.length} shown)
            </span>
          </h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="rounded-lg bg-[var(--surface-card)] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--action-primary)] w-48"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {SESSION_COLS.map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="px-4 py-3 text-left font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none whitespace-nowrap"
                  >
                    {label}
                    {sortCol === key && (
                      <span className="ml-1 text-[var(--text-faint)]">{sortAsc ? "↑" : "↓"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((s) => (
                <tr key={s.session_id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                    {new Date(s.first_seen).toLocaleDateString("en-US", { timeZone: "UTC" })}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                    {new Date(s.last_seen).toLocaleString("en-US", { timeZone: "UTC" })}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{s.device ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap">
                    {s.city && s.region
                      ? `${s.city}, ${s.region}`
                      : s.city ?? s.region ?? "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--text-secondary)]"
                    style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={s.utm_source ?? s.referrer ?? "direct"}
                  >
                    {(() => {
                      const val = s.utm_source ?? s.referrer ?? "direct";
                      return val.length > 30 ? val.slice(0, 30) + "…" : val;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.events.split(",").map((ev) => (
                        <span
                          key={ev}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            BADGE_COLORS[ev] ?? "bg-[var(--surface-subtle)] text-[var(--text-muted)]"
                          } ${HIGH_INTENT.has(ev) ? "font-bold ring-1 ring-[var(--status-success-text)]/40" : ""}`}
                        >
                          {HIGH_INTENT.has(ev) && "★ "}
                          {BADGE_LABELS[ev] ?? ev}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.converted ? (
                      <span className="text-[var(--status-success-text)] font-semibold">✓ Converted</span>
                    ) : s.engaged ? (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--status-pending-bg)] text-[var(--status-pending-text)]">
                        In quote flow
                      </span>
                    ) : (
                      <span className="text-[var(--text-faint)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-faint)]">
                    No sessions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
