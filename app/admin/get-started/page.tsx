// app/admin/get-started/page.tsx
//
// Step 36A: the shop's "Get started" checklist (GET/POST /api/admin/onboarding).
// Each step shows done (detected or ticked by hand), a link to where it's
// set up, and a hand tick for steps the app can't detect. Two buttons load
// starter foam / corrugated rates into fields that are still empty.
// The platform owner can open another shop with ?tenant_id=.

"use client";

import * as React from "react";
import Link from "next/link";
import type { Checklist, ChecklistItem } from "@/app/lib/onboarding-core";

type Resp = { ok: boolean; checklist?: Checklist; slug?: string; tenant_id?: number; message?: string };

export default function GetStartedPage() {
  const [tenantId, setTenantId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<Resp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTenantId(new URLSearchParams(window.location.search).get("tenant_id") || "");
  }, []);

  const load = React.useCallback(async () => {
    if (tenantId === null) return;
    setErr(null);
    try {
      const r = await fetch(`/api/admin/onboarding${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as Resp | null;
      if (!r.ok || !j?.ok) setErr(j?.message || `Couldn't load the checklist (HTTP ${r.status}).`);
      else setData(j);
    } catch (e) {
      setErr(String(e));
    }
  }, [tenantId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, key: string): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setErr(null);
    setNote(null);
    try {
      const r = await fetch("/api/admin/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tenantId ? { ...body, tenant_id: Number(tenantId) } : body),
      });
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok || !j?.ok) {
        setErr(String(j?.message || `Couldn't save (HTTP ${r.status}).`));
        return null;
      }
      return j;
    } catch (e) {
      setErr(String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function mark(item: ChecklistItem, done: boolean) {
    const j = await post({ step: item.key, done }, `mark:${item.key}`);
    if (j?.checklist) setData((d) => ({ ...(d || { ok: true }), checklist: j.checklist as Checklist }));
  }

  async function starter(kind: "foam" | "corrugated") {
    const j = await post({ starter: kind }, `starter:${kind}`);
    if (!j) return;
    if (kind === "foam") {
      const set = (j.set as string[]) || [];
      setNote(set.length ? `Loaded ${set.length} starter foam rate${set.length === 1 ? "" : "s"}. Check them in Pricing → Foam cutting rates.` : "Your foam rates were already set. Nothing changed.");
    } else {
      const s = (j.set as { rates: string[]; grades: number }) || { rates: [], grades: 0 };
      const n = s.rates.length;
      setNote(
        n || s.grades
          ? `Loaded ${n} starter corrugated rate${n === 1 ? "" : "s"} and ${s.grades} board price${s.grades === 1 ? "" : "s"}. Check them in Pricing → Corrugated boxes.`
          : "Your corrugated rates were already set. Nothing changed.",
      );
    }
    await load();
  }

  const cl = data?.checklist;
  const card = "rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4";
  const smallBtn =
    "rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-xs text-[var(--text-primary)] disabled:opacity-60";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-[var(--text-primary)]" data-get-started>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold">Get started</h1>
        {cl ? (
          <span className="text-xs text-[var(--text-muted)]" data-get-started-count>
            {cl.done} of {cl.total} done
          </span>
        ) : null}
        <Link href="/admin" className="ml-auto text-xs text-[var(--text-muted)] underline">
          Back to admin
        </Link>
      </div>

      {cl ? (
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div className="h-full bg-[var(--action-primary)]" style={{ width: `${Math.round((cl.done / cl.total) * 100)}%` }} />
        </div>
      ) : null}

      {cl?.complete ? (
        <div className={`${card} mb-4`} data-get-started-complete>
          Setup is complete. Your shop is ready to take quotes.
        </div>
      ) : null}

      {err ? <div className="mb-3 text-xs text-[var(--attention)]" role="alert">{err}</div> : null}
      {note ? <div className="mb-3 text-xs text-[var(--text-secondary)]" role="status" data-get-started-note>{note}</div> : null}
      {!cl && !err ? <div className="text-xs text-[var(--text-muted)]">Loading…</div> : null}

      {cl ? (
        <ol className="space-y-3">
          {cl.items.map((it, i) => (
            <li key={it.key} className={card} data-step={it.key} data-step-done={it.done ? "1" : "0"}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    it.done ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-white" : "border-[var(--border)] text-[var(--text-muted)]"
                  }`}
                >
                  {it.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{it.label}</span>
                    {it.how === "auto" ? <span className="text-[11px] text-[var(--text-muted)]">Done</span> : null}
                    {it.how === "manual" ? <span className="text-[11px] text-[var(--text-muted)]">Marked: {it.manual}</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{it.detail}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a href={it.href} className={smallBtn} data-step-link>
                      Open
                    </a>
                    {it.key === "foam_rates" && !it.done ? (
                      <button type="button" className={smallBtn} disabled={busy !== null} onClick={() => starter("foam")} data-starter="foam">
                        {busy === "starter:foam" ? "Loading…" : "Load starter foam rates"}
                      </button>
                    ) : null}
                    {it.key === "corrugated" && !it.done ? (
                      <button type="button" className={smallBtn} disabled={busy !== null} onClick={() => starter("corrugated")} data-starter="corrugated">
                        {busy === "starter:corrugated" ? "Loading…" : "Load starter corrugated rates"}
                      </button>
                    ) : null}
                    {it.manual && it.how !== "auto" ? (
                      it.how === "manual" ? (
                        <button type="button" className={smallBtn} disabled={busy !== null} onClick={() => mark(it, false)} data-step-unmark>
                          Undo
                        </button>
                      ) : (
                        <button type="button" className={smallBtn} disabled={busy !== null} onClick={() => mark(it, true)} data-step-mark>
                          {it.manual}
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {cl && !cl.complete ? (
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          Starter rates are typical US job-shop numbers. They only fill rates that are still empty, and you should check them against your own costs.
        </p>
      ) : null}
    </div>
  );
}
