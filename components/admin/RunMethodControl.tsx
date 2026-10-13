// components/admin/RunMethodControl.tsx
//
// Step 15: "Run method" on the admin quote page (Pricing snapshot card).
// Staff pick how the quote's boxes are made: Auto (the shop's short-run
// cutoff), Print plates (production run) or Digital + CAD cut (short run,
// no plates). Changing it reprices the boxes and reloads the page.

"use client";

import * as React from "react";

type Method = "auto" | "plates" | "digital";

type Info = { method: Method; cutoff: number; short_runs_on: boolean; locked: boolean };

export default function RunMethodControl({ quoteNo }: { quoteNo: string }) {
  const [info, setInfo] = React.useState<Info | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/quotes/run-method?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        setInfo({
          method: j.method === "plates" || j.method === "digital" ? j.method : "auto",
          cutoff: Number(j.cutoff) || 0,
          short_runs_on: j.short_runs_on === true,
          locked: j.locked === true,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  if (!info) return null;

  const save = async (m: Method) => {
    if (m === info.method) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/run-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, method: m }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't change the run method (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const autoText = info.short_runs_on
    ? `Auto: under ${info.cutoff.toLocaleString("en-US")} boxes is digital print + CAD cut (no plates).`
    : "Auto: short runs are off for this shop. Set the cutoff and a CAD cut rate in Admin → Corrugated.";

  return (
    <div style={{ marginBottom: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }} data-run-method-control>
      <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-primary)" }}>Run method</span>
        <select
          value={info.method}
          disabled={busy || info.locked}
          onChange={(e) => save(e.target.value === "plates" ? "plates" : e.target.value === "digital" ? "digital" : "auto")}
          style={{
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--surface-card)",
            color: "var(--text-primary)",
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          <option value="auto">Auto (by quantity)</option>
          <option value="plates">Print plates (production run)</option>
          <option value="digital">Digital print + CAD cut</option>
        </select>
        {busy ? <span>Repricing…</span> : null}
      </label>
      <div style={{ marginTop: 4 }}>
        {info.locked ? "Released quote: revise it to change the run method." : autoText}
      </div>
      {note ? <div style={{ marginTop: 6, color: "var(--attention)" }}>{note}</div> : null}
    </div>
  );
}
