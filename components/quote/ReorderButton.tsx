// components/quote/ReorderButton.tsx
//
// Step 34B: "Reorder" with its dialog, for the buyer portal
// (endpoint /api/portal/reorder) and the admin quote page
// (/api/admin/quotes/reorder). The dialog loads the order (GET), pre-fills
// the same quantities, asks whether the artwork changed on printed jobs,
// then POSTs and opens the new quote.
"use client";

import * as React from "react";

type Info = {
  quote_no: string;
  foam: { sets: number; label: string } | null;
  boxes: { id: number; qty: number; label: string }[];
  printed: boolean;
  proof_version: number | null;
};

export default function ReorderButton({
  quoteNo,
  endpoint,
  label = "Reorder",
  buttonStyle,
  buttonClassName,
}: {
  quoteNo: string;
  endpoint: "/api/portal/reorder" | "/api/admin/quotes/reorder";
  label?: string;
  buttonStyle?: React.CSSProperties;
  buttonClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState<Info | null>(null);
  const [foam, setFoam] = React.useState("");
  const [boxes, setBoxes] = React.useState<Record<number, string>>({});
  const [artChanged, setArtChanged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = async () => {
    setOpen(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch(`${endpoint}?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setError(j?.message || `Couldn't load the order (HTTP ${r.status}).`);
        return;
      }
      const i = j.info as Info;
      setInfo(i);
      setFoam(i.foam ? String(i.foam.sets) : "");
      setBoxes(Object.fromEntries(i.boxes.map((b) => [b.id, String(b.qty)])));
      setArtChanged(false);
    } catch {
      setError("Network error. Please try again.");
    }
  };

  const submit = async () => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        quote_no: info.quote_no,
        boxes: info.boxes.map((b) => ({ id: b.id, qty: boxes[b.id] === "" ? 0 : Number(boxes[b.id]) })),
        artwork_changed: artChanged,
      };
      if (info.foam) body.foam_qty = Number(foam);
      const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setError(r.status === 429 ? "Too many attempts. Please wait a minute." : j?.message || `Couldn't make the reorder (HTTP ${r.status}).`);
        return;
      }
      window.location.assign(String(j.open_url || j.url));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    width: 110,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--surface-page)",
    color: "var(--text-primary)",
    padding: "6px 9px",
    fontSize: 14,
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    borderRadius: 8,
    border: `1px solid ${primary ? "var(--action-primary)" : "var(--border)"}`,
    background: primary ? "var(--action-primary)" : "var(--surface-card)",
    color: primary ? "#fff" : "var(--text-primary)",
    padding: "8px 14px",
    fontSize: 14,
    fontWeight: 600,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  });

  return (
    <>
      <button type="button" onClick={() => void start()} style={buttonStyle} className={buttonClassName} data-reorder-open={quoteNo}>
        {label}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Reorder ${quoteNo}`}
          data-reorder-dialog
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div style={{ width: "100%", maxWidth: 520, background: "var(--surface-card)", color: "var(--text-primary)", borderRadius: 14, padding: 22, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Reorder {quoteNo}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
              Makes a new quote with the same job at today&apos;s prices. You review and accept it as usual.
            </div>
            {!info && !error ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div> : null}
            {info ? (
              <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                {info.foam ? (
                  <label style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <span>
                      Foam sets
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{info.foam.label}</div>
                    </span>
                    <input style={input} inputMode="numeric" aria-label="Foam sets" value={foam} onChange={(e) => setFoam(e.target.value.replace(/[^\d]/g, ""))} data-reorder-foam />
                  </label>
                ) : null}
                {info.boxes.map((b) => (
                  <label key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <span style={{ minWidth: 0 }}>
                      Boxes
                      <div style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{b.label}</div>
                    </span>
                    <input
                      style={input}
                      inputMode="numeric"
                      aria-label={`Quantity for ${b.label}`}
                      value={boxes[b.id] ?? ""}
                      onChange={(e) => setBoxes((m) => ({ ...m, [b.id]: e.target.value.replace(/[^\d]/g, "") }))}
                      data-reorder-box={b.id}
                    />
                  </label>
                ))}
                {info.boxes.length ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>0 leaves a box line off.</div> : null}
                {info.printed ? (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                    <input type="checkbox" checked={artChanged} onChange={(e) => setArtChanged(e.target.checked)} data-reorder-art-changed />
                    <span>
                      The artwork changed
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {artChanged
                          ? "You'll get a new proof to approve before production."
                          : info.proof_version
                            ? `Uses the approved proof v${info.proof_version}; no new proof needed.`
                            : "There's no approved proof on this order, so a new one will be sent."}
                      </div>
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <div role="alert" style={{ marginTop: 10, fontSize: 13, color: "var(--attention)" }} data-reorder-error>
                {error}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" style={btn(true)} disabled={busy || !info} onClick={() => void submit()} data-reorder-submit>
                {busy ? "Making the new quote…" : "Make the new quote"}
              </button>
              <button type="button" style={btn(false)} disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
