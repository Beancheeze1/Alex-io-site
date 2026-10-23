// components/admin/CommissionCard.tsx
//
// Step 39O: who gets the commission on this quote (admin quote page). Staff
// see it; an admin can change it until the quote is released or its
// commission is paid out (GET / POST /api/admin/quotes/commission).

"use client";

import * as React from "react";
import { repLabel, type RepOption } from "@/app/lib/account-rep-core";

type Info = {
  ready: boolean;
  rep_id: number | null;
  account_rep_id: number | null;
  customer_id: number | null;
  reps: RepOption[];
  can_change: boolean;
  why_not: string | null;
};

export default function CommissionCard({ quoteNo, labelStyle }: { quoteNo: string; labelStyle?: React.CSSProperties }) {
  const [info, setInfo] = React.useState<Info | null>(null);
  const [pick, setPick] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await fetch(`/api/admin/quotes/commission?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) {
      setInfo(j as Info);
      setPick(j.rep_id ? String(j.rep_id) : "");
    }
  }, [quoteNo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!info) return null;
  const name = (id: number | null) => (id ? repLabel(info.reps.find((r) => r.id === id) ?? { name: `User #${id}`, role: "" }) : "No commission");

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/quotes/commission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, rep_id: pick ? Number(pick) : null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) setMsg(j?.message || `Couldn't save (HTTP ${res.status}).`);
      else {
        setMsg("Saved.");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-commission-card>
      <div style={labelStyle}>Commission to</div>
      <div data-commission-rep>{name(info.rep_id)}</div>
      {info.ready ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          Account rep: {info.account_rep_id ? name(info.account_rep_id) : "none"}
          {info.customer_id ? (
            <>
              {" "}
              (
              <a href={`/admin/customers/${info.customer_id}`} style={{ textDecoration: "underline", color: "var(--text-muted)" }}>
                set on the customer
              </a>
              )
            </>
          ) : null}
        </div>
      ) : null}
      {info.can_change ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <select
            aria-label="Commission to"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            style={{ borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-card)", color: "var(--text-primary)", padding: "4px 8px", fontSize: 12 }}
            data-commission-select
          >
            <option value="">No commission</option>
            {info.reps.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {repLabel(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={busy || pick === (info.rep_id ? String(info.rep_id) : "")}
            style={{ borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--surface-card)", color: "var(--text-primary)", padding: "4px 10px", fontSize: 12, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
            data-commission-save
          >
            {busy ? "Saving…" : "Change"}
          </button>
        </div>
      ) : info.why_not ? (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{info.why_not}</div>
      ) : null}
      {msg ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{msg}</div> : null}
    </div>
  );
}
