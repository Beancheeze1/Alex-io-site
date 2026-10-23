// components/admin/AccountRepCard.tsx
//
// Step 39O: the customer's account rep (customer page). New quotes for this
// customer are credited to them unless the quote came in on someone's
// /q/<slug> link or staff chose "Commission to" on the form. Admin only
// (PATCH /api/admin/customers/[id]); reps from GET /api/admin/reps.

"use client";

import * as React from "react";
import { repLabel, type RepOption } from "@/app/lib/account-rep-core";

export default function AccountRepCard({ customerId }: { customerId: number }) {
  const [reps, setReps] = React.useState<RepOption[]>([]);
  const [ready, setReady] = React.useState(true);
  const [saved, setSaved] = React.useState<number | null>(null);
  const [pick, setPick] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/admin/reps", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch(`/api/admin/customers/${customerId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]).then(([r, c]) => {
      if (!alive) return;
      setReps(Array.isArray(r?.reps) ? r.reps : []);
      setReady(r?.ready !== false);
      const id = c?.customer?.account_rep_id ? Number(c.customer.account_rep_id) : null;
      setSaved(id);
      setPick(id ? String(id) : "");
    });
    return () => {
      alive = false;
    };
  }, [customerId]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_rep_id: pick ? Number(pick) : null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) setMsg(j?.message || `Couldn't save (HTTP ${res.status}).`);
      else {
        setSaved(j.account_rep_id ?? null);
        setMsg("Saved. New quotes for this customer are credited to this rep.");
      }
    } finally {
      setBusy(false);
    }
  };

  const current = reps.find((r) => r.id === saved) ?? null;
  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-sm" data-account-rep>
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Account rep</div>
      {!ready ? (
        <div className="mt-1 text-xs text-[var(--text-muted)]">Available after the database update (migration 051) runs.</div>
      ) : (
        <>
          <div className="mt-1 text-[var(--text-secondary)]">
            {saved ? repLabel(current) : "None"}: new quotes for this customer are credited to the account rep, unless the
            quote came in on someone&apos;s link or staff chose who gets the commission.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              aria-label="Account rep"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-sm text-[var(--text-primary)]"
              data-account-rep-select
            >
              <option value="">No account rep</option>
              {reps.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {repLabel(r)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={save}
              disabled={busy || pick === (saved ? String(saved) : "")}
              className="rounded-md bg-[var(--action-primary)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              data-account-rep-save
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          {reps.length === 0 ? (
            <div className="mt-1 text-xs text-[var(--text-muted)]">No team members have a sales slug yet (Admin → Team).</div>
          ) : null}
          {msg ? <div className="mt-1 text-xs text-[var(--text-muted)]">{msg}</div> : null}
        </>
      )}
    </div>
  );
}
