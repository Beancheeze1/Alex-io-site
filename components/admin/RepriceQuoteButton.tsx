// components/admin/RepriceQuoteButton.tsx
//
// Step 10B: "Reprice at today's rates" on the admin quote page. Saved quotes
// keep their prices until something on them changes; this moves the whole
// quote (foam, boxes, printing / die-cut charges) to the shop's current rates.

"use client";

import * as React from "react";

export default function RepriceQuoteButton({ quoteNo, locked }: { quoteNo: string; locked: boolean }) {
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/reprice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't reprice (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const btn: React.CSSProperties = {
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    padding: "6px 10px",
    fontSize: 12,
    cursor: busy || locked ? "not-allowed" : "pointer",
    opacity: busy || locked ? 0.6 : 1,
  };

  return (
    <div style={{ marginBottom: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }} data-reprice-quote>
      <div>Prices are saved with the quote and only change when the quote changes.</div>
      {locked ? (
        <div style={{ marginTop: 6 }}>Released quote: revise it to reprice.</div>
      ) : confirming ? (
        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-primary)" }}>Move this quote to today&apos;s rates?</span>
          <button type="button" style={btn} disabled={busy} onClick={run}>
            {busy ? "Repricing…" : "Yes, reprice"}
          </button>
          <button type="button" style={btn} disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          <button type="button" style={btn} onClick={() => setConfirming(true)}>
            Reprice at today&apos;s rates
          </button>
        </div>
      )}
      {note ? <div style={{ marginTop: 6, color: "var(--attention)" }}>{note}</div> : null}
    </div>
  );
}
