// components/admin/ShippedCard.tsx
//
// Step 34A: "Mark shipped" on the admin quote page, for released quotes
// (GET / POST /api/admin/quotes/shipped). Carrier (required), tracking and a
// note; emails the buyer the first time unless "Email the buyer" is off.
// Shown by AdminQuoteClient only when the quote is released.

"use client";

import * as React from "react";
import { CARRIERS } from "@/app/lib/portal-core";

type Shipped = { at: string; carrier: string | null; tracking: string | null; tracking_url: string | null; note: string | null; by: string | null };

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export default function ShippedCard({ quoteNo }: { quoteNo: string }) {
  const [shipped, setShipped] = React.useState<Shipped | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [carrier, setCarrier] = React.useState("");
  const [tracking, setTracking] = React.useState("");
  const [note, setNote] = React.useState("");
  const [notify, setNotify] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const load = React.useCallback(async () => {
    const r = await fetch(`/api/admin/quotes/shipped?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) setShipped(j.shipped as Shipped | null);
    setLoaded(true);
  }, [quoteNo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    setCarrier(shipped?.carrier || "");
    setTracking(shipped?.tracking || "");
    setNote(shipped?.note || "");
    setEditing(true);
    setMsg(null);
  };

  const post = async (body: Record<string, unknown>, okText: (j: { email?: string | null }) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/quotes/shipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, ...body }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setMsg({ ok: false, text: j?.message || `Couldn't save (HTTP ${r.status}).` });
        return;
      }
      setShipped(j.shipped as Shipped | null);
      setEditing(false);
      setMsg({ ok: true, text: okText(j) });
    } finally {
      setBusy(false);
    }
  };

  const box: React.CSSProperties = {
    borderRadius: 8,
    border: `1px solid ${shipped ? "var(--status-success-text)" : "var(--border)"}`,
    background: "var(--surface-card)",
    padding: 10,
    marginTop: 4,
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  };
  const input: React.CSSProperties = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    padding: "6px 9px",
    fontSize: 13,
    marginTop: 4,
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    marginTop: 6,
    marginRight: 6,
    borderRadius: 8,
    border: `1px solid ${primary ? "var(--action-primary)" : "var(--border)"}`,
    background: primary ? "var(--action-primary)" : "var(--surface-card)",
    color: primary ? "#fff" : "var(--text-primary)",
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  });

  if (!loaded) return null;

  return (
    <div style={box} data-shipped-card={shipped ? "shipped" : "not_shipped"}>
      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text-primary)", marginBottom: 4 }}>Shipping</div>
      {shipped && !editing ? (
        <div data-shipped-info>
          Shipped {day(shipped.at)}
          {shipped.carrier ? ` by ${shipped.carrier}` : ""}
          {shipped.tracking ? (
            <>
              {" · "}
              {shipped.tracking_url ? (
                <a href={shipped.tracking_url} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {shipped.tracking}
                </a>
              ) : (
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{shipped.tracking}</span>
              )}
            </>
          ) : null}
          {shipped.note ? <div>Note: {shipped.note}</div> : null}
          {shipped.by ? <div style={{ color: "var(--text-muted)" }}>Marked by {shipped.by}</div> : null}
          <div>
            <button type="button" style={btn(false)} disabled={busy} onClick={startEdit} data-shipped-edit>
              Edit
            </button>
            <button type="button" style={btn(false)} disabled={busy} onClick={() => void post({ clear: true }, () => "Shipping cleared.")} data-shipped-clear>
              Not shipped
            </button>
          </div>
        </div>
      ) : !editing ? (
        <div>
          Not shipped yet.
          <div>
            <button type="button" style={btn(true)} disabled={busy} onClick={startEdit} data-shipped-start>
              Mark shipped
            </button>
          </div>
        </div>
      ) : (
        <div data-shipped-form>
          <select style={input} aria-label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} data-shipped-carrier>
            <option value="">Carrier…</option>
            {[...CARRIERS, ...(carrier && !(CARRIERS as readonly string[]).includes(carrier) ? [carrier] : [])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input style={input} aria-label="Tracking number" placeholder="Tracking / PRO number (optional)" value={tracking} maxLength={80} onChange={(e) => setTracking(e.target.value)} data-shipped-tracking />
          <input style={input} aria-label="Note for the buyer" placeholder="Note for the buyer (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-shipped-note />
          {!shipped ? (
            <label style={{ display: "flex", gap: 6, marginTop: 6, color: "var(--text-primary)" }}>
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} data-shipped-notify /> Email the buyer
            </label>
          ) : null}
          <div>
            <button
              type="button"
              style={btn(true)}
              disabled={busy || !carrier}
              data-shipped-save
              onClick={() =>
                void post({ carrier, tracking, note, notify_buyer: notify }, (j) =>
                  j.email === "sent" ? "Marked shipped and the buyer emailed." : j.email ? `Marked shipped (email ${j.email}).` : "Saved.",
                )
              }
            >
              {shipped ? "Save" : "Mark shipped"}
            </button>
            <button type="button" style={btn(false)} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg ? (
        <div style={{ marginTop: 4, color: msg.ok ? "var(--status-success-text)" : "var(--attention)" }} data-shipped-msg>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
