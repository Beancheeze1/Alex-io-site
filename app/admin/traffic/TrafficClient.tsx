"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TrafficData } from "./page";

const FUNNEL_ORDER = [
  "page_view",
  "scroll_50",
  "cta_click",
  "form_start",
  "form_submit",
] as const;

const FUNNEL_COLORS: Record<string, string> = {
  page_view:   "#38bdf8",
  scroll_50:   "#818cf8",
  cta_click:   "#fb923c",
  form_start:  "#facc15",
  form_submit: "#4ade80",
};

const FUNNEL_LABELS: Record<string, string> = {
  page_view:   "Page View",
  scroll_50:   "Scrolled 50%",
  cta_click:   "CTA Click",
  form_start:  "Form Start",
  form_submit: "Form Submit",
};

const BADGE_COLORS: Record<string, string> = {
  page_view:     "bg-sky-400/20 text-sky-300",
  scroll_50:     "bg-indigo-400/20 text-indigo-300",
  cta_click:     "bg-orange-400/20 text-orange-300",
  form_start:    "bg-yellow-400/20 text-yellow-300",
  form_submit:   "bg-green-400/20 text-green-300",
  sample_editor: "bg-indigo-400/20 text-indigo-300",
  sample_skip:   "bg-orange-400/20 text-orange-300",
  quote_applied: "bg-emerald-400/25 text-emerald-300",
  quote_email:   "bg-emerald-400/25 text-emerald-300",
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
  return n.toLocaleString();
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
    <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
      <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
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
        <h1 className="text-xl font-bold text-white">Landing Traffic</h1>
        <div className="flex gap-2">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                days === d
                  ? "bg-sky-500 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
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
      <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-5">
        <h2 className="text-sm font-semibold text-neutral-200 mb-4">Conversion Funnel</h2>
        <div className="space-y-3">
          {FUNNEL_ORDER.map((et) => {
            const count = funnelMap[et] ?? 0;
            const width = pageViews ? Math.round((count / pageViews) * 100) : 0;
            return (
              <div key={et} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-xs text-neutral-400">{FUNNEL_LABELS[et]}</div>
                <div className="flex-1 h-5 rounded bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${width}%`,
                      backgroundColor: FUNNEL_COLORS[et],
                    }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right text-xs text-neutral-300">
                  {fmt(count)}{" "}
                  <span className="text-neutral-500">({pct(count, pageViews)})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily activity chart */}
      <div
        className="rounded-xl border border-neutral-800 p-5"
        style={{ backgroundColor: "#171717" }}
      >
        <h2 className="text-sm font-semibold text-neutral-200 mb-4">Daily Activity</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={daily} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis dataKey="day" tick={{ fill: "#737373", fontSize: 11 }} />
            <YAxis tick={{ fill: "#737373", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#171717",
                border: "1px solid #404040",
                borderRadius: 8,
              }}
              labelStyle={{ color: "#e5e5e5" }}
              itemStyle={{ color: "#e5e5e5" }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} />
            <Line
              type="monotone"
              dataKey="page_views"
              stroke="#38bdf8"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="cta_clicks"
              stroke="#fb923c"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="form_submits"
              stroke="#4ade80"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Traffic sources table */}
      <div className="rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-200">Traffic Sources</h2>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-800">
              <th className="px-4 py-3 text-left font-medium text-neutral-500">Source</th>
              <th className="px-4 py-3 text-right font-medium text-neutral-500">Sessions</th>
              <th className="px-4 py-3 text-right font-medium text-neutral-500">CTA Clicks</th>
              <th className="px-4 py-3 text-right font-medium text-neutral-500">CTA Rate</th>
              <th className="px-4 py-3 text-right font-medium text-neutral-500">Demo Subs</th>
              <th className="px-4 py-3 text-right font-medium text-neutral-500">Conv Rate</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source} className="border-b border-neutral-800 last:border-0">
                <td className="px-4 py-3 text-neutral-200">{s.source}</td>
                <td className="px-4 py-3 text-right text-neutral-300">{fmt(s.sessions)}</td>
                <td className="px-4 py-3 text-right text-neutral-300">{fmt(s.cta_clicks)}</td>
                <td className="px-4 py-3 text-right text-neutral-400">{pct(s.cta_clicks, s.sessions)}</td>
                <td className="px-4 py-3 text-right text-neutral-300">{fmt(s.form_submits)}</td>
                <td className="px-4 py-3 text-right text-neutral-400">{pct(s.form_submits, s.sessions)}</td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-600">
                  No data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent sessions table */}
      <div className="rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-200">
            Recent Sessions
            <span className="ml-2 text-xs font-normal text-neutral-600">
              ({filteredSessions.length} shown)
            </span>
          </h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 outline-none focus:border-sky-600 w-48"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800">
                {SESSION_COLS.map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="px-4 py-3 text-left font-medium text-neutral-500 cursor-pointer hover:text-neutral-300 select-none whitespace-nowrap"
                  >
                    {label}
                    {sortCol === key && (
                      <span className="ml-1 text-neutral-600">{sortAsc ? "↑" : "↓"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((s) => (
                <tr key={s.session_id} className="border-b border-neutral-800 last:border-0">
                  <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">
                    {new Date(s.first_seen).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">
                    {new Date(s.last_seen).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-neutral-300">{s.device ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-300 whitespace-nowrap">
                    {s.city && s.region
                      ? `${s.city}, ${s.region}`
                      : s.city ?? s.region ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-300">
                    {s.utm_source ?? s.referrer ?? "direct"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.events.split(",").map((ev) => (
                        <span
                          key={ev}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            BADGE_COLORS[ev] ?? "bg-neutral-700 text-neutral-400"
                          } ${HIGH_INTENT.has(ev) ? "font-bold ring-1 ring-emerald-500/40" : ""}`}
                        >
                          {HIGH_INTENT.has(ev) && "★ "}
                          {BADGE_LABELS[ev] ?? ev}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.converted ? (
                      <span className="text-green-400 font-semibold">Yes</span>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-600">
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
