// app/admin/funnel/page.tsx
//
// Step 35: the quote funnel (GET /api/admin/funnel). Date range 30 / 90 /
// 365 days; the platform owner can pick a shop or all shops. Stage bars
// with counts, conversion and $; by channel, by rep (and by shop); median
// cycle times; quotes waiting too long; CSV download.

"use client";

import * as React from "react";
import Link from "next/link";
import { durationLabel, RANGE_DAYS, STALL_DAYS, type CycleRow, type GroupRow, type StageRow, type StalledRow } from "@/app/lib/funnel-core";

type Resp = {
  ok: boolean;
  days: number;
  scope: { tenant: "all" | number; owner: boolean };
  shops?: { id: number; name: string }[];
  funnel: StageRow[];
  by_channel: GroupRow[];
  by_rep: GroupRow[];
  by_shop?: GroupRow[];
  cycle: CycleRow[];
  stalled: StalledRow[];
  totals: { quotes: number; emailed: number; reorders: number };
  capped: boolean;
  message?: string;
};

const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function FunnelPage() {
  const [days, setDays] = React.useState<number>(90);
  const [tenant, setTenant] = React.useState<string>("");
  const [data, setData] = React.useState<Resp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const qs = React.useMemo(() => {
    const p = new URLSearchParams({ days: String(days) });
    if (tenant) p.set("tenant", tenant);
    return p.toString();
  }, [days, tenant]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/admin/funnel?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as Resp | null;
        if (!alive) return;
        if (!r.ok || !j?.ok) setErr(j?.message || `Couldn't load the funnel (HTTP ${r.status}).`);
        else setData(j);
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [qs]);

  const btn = (on: boolean) =>
    `rounded-md border px-3 py-1 text-xs ${on ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-white" : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)]"}`;
  const card = "rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4";
  const h2 = "mb-2 text-sm font-semibold text-[var(--text-primary)]";
  const th = "border-b border-[var(--border)] px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
  const td = "border-b border-[var(--border)] px-2 py-1.5";
  const created = data?.funnel[0]?.count || 0;

  const groupTable = (title: string, rows: GroupRow[], attr: string) => (
    <section className={card} data-funnel-group={attr}>
      <h2 className={h2}>{title}</h2>
      {rows.length === 0 ? (
        <div className="text-xs text-[var(--text-faint)]">No quotes.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={th}></th>
              <th className={`${th} text-right`}>Quotes</th>
              <th className={`${th} text-right`}>Accepted</th>
              <th className={`${th} text-right`}>Confirmed</th>
              <th className={`${th} text-right`}>Win rate</th>
              <th className={`${th} text-right`}>Confirmed $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-group-row={r.key}>
                <td className={td}>{r.label}</td>
                <td className={`${td} text-right tabular-nums`}>{r.created}</td>
                <td className={`${td} text-right tabular-nums`}>{r.accepted}</td>
                <td className={`${td} text-right tabular-nums`}>{r.confirmed}</td>
                <td className={`${td} text-right tabular-nums`}>{pct(r.win_rate)}</td>
                <td className={`${td} text-right tabular-nums`}>{usd(r.confirmed_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-[var(--text-primary)]" data-funnel-page>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Quote funnel</h1>
        <div className="flex gap-1">
          {RANGE_DAYS.map((d) => (
            <button key={d} type="button" className={btn(days === d)} onClick={() => setDays(d)} data-funnel-days={d}>
              {d === 365 ? "12 months" : `${d} days`}
            </button>
          ))}
        </div>
        {data?.scope.owner && data.shops ? (
          <select
            className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs"
            aria-label="Shop"
            value={tenant || (data.scope.tenant === "all" ? "all" : String(data.scope.tenant))}
            onChange={(e) => setTenant(e.target.value)}
            data-funnel-shop
          >
            <option value="all">All shops</option>
            {data.shops.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        <a className={btn(false)} href={`/api/admin/funnel?${qs}&format=csv`} data-funnel-csv>
          Download CSV
        </a>
        {loading ? <span className="text-xs text-[var(--text-muted)]">Loading…</span> : null}
      </div>

      {err ? <div className="mb-3 text-xs text-[var(--attention)]">{err}</div> : null}

      {data ? (
        <div className="grid gap-4">
          <section className={card} data-funnel-stages>
            <h2 className={h2}>
              Quotes created in the last {data.days === 365 ? "12 months" : `${data.days} days`}
            </h2>
            <div className="grid gap-2">
              {data.funnel.map((s) => (
                <div key={s.key} className="grid grid-cols-[180px_1fr_200px] items-center gap-3" data-stage={s.key}>
                  <div className="text-xs">{s.label}</div>
                  <div className="h-6 rounded bg-[var(--surface-page)]">
                    {s.count > 0 ? (
                      <div
                        className="flex h-6 items-center rounded bg-[var(--action-primary)] px-2 text-[11px] font-semibold text-white"
                        style={{ width: `${created ? Math.max(4, (s.count / created) * 100) : 0}%`, minWidth: 28 }}
                      >
                        {s.count}
                      </div>
                    ) : (
                      // Step 36E: no bar at all for an empty stage, just the 0
                      <div className="flex h-6 items-center px-2 text-[11px] text-[var(--text-muted)]" data-stage-empty>
                        0
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs tabular-nums text-[var(--text-secondary)]">
                    {s.pct_of_previous != null ? `${pct(s.pct_of_previous)} of previous` : ""}
                    {s.value != null && (s.value > 0 || s.no_total < s.count) ? ` · ${usd(s.value)}` : ""}
                    {s.value != null && s.no_total > 0 ? (
                      <span className="block text-[11px] text-[var(--text-muted)]" data-stage-no-total>
                        {s.key === "accepted" ? `${s.no_total} released without the buyer accepting` : `${s.no_total} without an accepted price`}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-[var(--text-muted)]" data-funnel-totals>
              {data.totals.emailed} emailed to the buyer · {data.totals.reorders} reorders
              {data.capped ? " · showing the most recent 20,000 quotes" : ""}
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            {groupTable("By channel", data.by_channel, "channel")}
            {groupTable("By sales rep", data.by_rep, "rep")}
          </div>
          {data.by_shop ? groupTable("By shop", data.by_shop, "shop") : null}

          <section className={card} data-funnel-cycle>
            <h2 className={h2}>Cycle times (median)</h2>
            <table className="w-full text-xs">
              <tbody>
                {data.cycle.map((c) => (
                  <tr key={c.key} data-cycle={c.key}>
                    <td className={td}>{c.label}</td>
                    <td className={`${td} text-right tabular-nums`}>{durationLabel(c.median_hours)}</td>
                    <td className={`${td} text-right text-[var(--text-muted)]`}>
                      {c.count} quote{c.count === 1 ? "" : "s"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={card} data-funnel-stalled>
            <h2 className={h2}>Waiting too long ({data.stalled.length})</h2>
            <div className="mb-2 text-[11px] text-[var(--text-muted)]">
              Estimates over {STALL_DAYS.estimate} days without acceptance (not expired), accepted over {STALL_DAYS.accepted} days without
              confirmation, confirmed over {STALL_DAYS.confirmed} days without release, released over {STALL_DAYS.production} days without
              shipping.
            </div>
            {data.stalled.length === 0 ? (
              <div className="text-xs text-[var(--text-faint)]">Nothing is stuck.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={th}>Quote</th>
                    <th className={th}>Waiting at</th>
                    <th className={th}>Since</th>
                    <th className={`${th} text-right`}>Days</th>
                    <th className={`${th} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stalled.map((s) => (
                    <tr key={s.quote_no} data-stalled={s.quote_no}>
                      <td className={td}>
                        {s.admin_url && /^https?:/.test(s.admin_url) ? (
                          <a href={s.admin_url} className="font-semibold hover:underline" target="_blank" rel="noopener noreferrer" data-stalled-external>
                            {s.quote_no}
                          </a>
                        ) : (
                          <Link href={s.admin_url || `/admin/quotes/${encodeURIComponent(s.quote_no)}`} className="font-semibold hover:underline">
                            {s.quote_no}
                          </Link>
                        )}
                        {s.customer ? <span className="text-[var(--text-muted)]"> · {s.customer}</span> : null}
                      </td>
                      <td className={td}>{s.stage}</td>
                      <td className={td}>{day(s.since)}</td>
                      <td className={`${td} text-right tabular-nums`}>{s.days}</td>
                      <td className={`${td} text-right tabular-nums`}>{usd(s.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
