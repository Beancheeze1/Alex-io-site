// components/quote/QuoteApprovalCard.tsx
//
// Step 28: the buyer's side of estimate -> accepted -> confirmed on the quote
// page. Shows where the quote stands, how long the price is valid and the
// lead time; a buyer with the edit link can accept (or re-approve a changed
// price) with their name and an optional PO number (POST /api/quote/accept).

"use client";

import * as React from "react";

export type QuoteApprovalView = {
  stage: "estimate" | "accepted" | "needs_reapproval" | "confirmed";
  current_total: number;
  accepted: { at: string; name: string | null; po: string | null; total: number; by_staff: boolean } | null;
  confirmed: { at: string; by: string | null; total: number } | null;
  expires_at: string | null;
  expired: boolean;
  lead_time: string | null;
  buyer_can_edit?: boolean;
  can_accept?: boolean;
};

const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "";
};

const TITLE: Record<QuoteApprovalView["stage"], string> = {
  estimate: "Estimate",
  accepted: "Accepted: waiting for the shop to confirm",
  needs_reapproval: "The price changed: please re-approve",
  confirmed: "Confirmed by the shop",
};

export default function QuoteApprovalCard({ quoteNo, approval }: { quoteNo: string; approval: QuoteApprovalView | null }) {
  // Step 36C: a re-approval starts from the earlier acceptance's name and PO.
  const earlier = approval?.stage === "needs_reapproval" ? approval.accepted : null;
  const [name, setName] = React.useState(earlier?.name || "");
  const [po, setPo] = React.useState(earlier?.po || "");
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!approval || !(approval.current_total > 0)) return null;
  const a = approval;
  const reapprove = a.stage === "needs_reapproval";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quote/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, name, po, agree }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setError(j?.message || `We couldn't record your acceptance (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Step 37I: when the buyer can accept, the card stands out in the shop's color.
  const actionable = !!a.can_accept && !a.expired;
  const brand = "var(--tenant-primary, var(--action-primary))";
  const box: React.CSSProperties = {
    borderRadius: 16,
    border: actionable
      ? `2px solid ${reapprove ? "var(--attention)" : brand}`
      : `1px solid ${a.stage === "confirmed" ? "var(--status-success-text)" : reapprove ? "var(--attention)" : "var(--border)"}`,
    boxShadow: actionable ? `0 0 0 4px color-mix(in srgb, ${reapprove ? "var(--attention)" : brand} 14%, transparent)` : undefined,
    background: "var(--surface-card)",
    padding: "12px 14px",
    marginTop: 4,
  };
  const input: React.CSSProperties = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    padding: "7px 10px",
    fontSize: 13,
  };
  const muted: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };

  return (
    <div style={box} data-quote-approval={a.stage}>
      <div style={{ fontSize: actionable ? 16 : 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }} data-approval-title>
        {actionable && a.stage === "estimate" ? "Accept this quote" : TITLE[a.stage]}
      </div>

      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        {a.stage === "estimate" ? (
          <div>This price is an estimate until you accept it and the shop confirms it.</div>
        ) : null}
        {a.accepted ? (
          <div data-approval-accepted>
            Accepted by {a.accepted.name || "the buyer"} on {day(a.accepted.at)}
            {a.accepted.po ? ` · PO ${a.accepted.po}` : ""} at {usd(a.accepted.total)}
            {a.accepted.by_staff ? " (recorded by the shop)" : ""}.
          </div>
        ) : null}
        {reapprove ? (
          <div>
            The quote total is now <strong>{usd(a.current_total)}</strong>. Re-approve it so the shop can confirm your order.
          </div>
        ) : null}
        {a.stage === "confirmed" && a.confirmed ? (
          <div data-approval-confirmed>
            Confirmed by the shop on {day(a.confirmed.at)} at {usd(a.confirmed.total)}.
          </div>
        ) : null}
        {a.stage !== "confirmed" && a.expires_at ? (
          <div data-approval-expiry style={a.expired ? { color: "var(--attention)" } : undefined}>
            {a.expired
              ? `This price expired on ${day(a.expires_at)}. Ask the shop to refresh it.`
              : `Price valid until ${day(a.expires_at)}.`}
          </div>
        ) : null}
        {a.lead_time ? <div data-approval-lead>Lead time: {a.lead_time}</div> : null}
      </div>

      {a.can_accept ? (
        <div style={{ marginTop: 10 }} data-accept-form>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <label>
              <div style={muted}>Your name</div>
              <input style={input} aria-label="Your name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <div style={muted}>PO number (optional)</div>
              <input style={input} aria-label="PO number" value={po} maxLength={60} onChange={(e) => setPo(e.target.value)} />
            </label>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: 13, color: "var(--text-primary)" }}>
            <input type="checkbox" aria-label="I accept this estimate" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              I accept this estimate of {usd(a.current_total)}. The shop will confirm it before anything is made.
            </span>
          </label>
          <button
            type="button"
            data-accept-button
            disabled={busy || !agree || !name.trim()}
            onClick={submit}
            style={{
              marginTop: 8,
              borderRadius: 8,
              border: `1px solid ${brand}`,
              background: brand,
              color: "#fff",
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy || !agree || !name.trim() ? "not-allowed" : "pointer",
              opacity: busy || !agree || !name.trim() ? 0.6 : 1,
            }}
          >
            {busy ? "Saving…" : reapprove ? "Re-approve new price" : "Accept quote"}
          </button>
          {error ? <div style={{ ...muted, color: "var(--attention)", marginTop: 6 }}>{error}</div> : null}
        </div>
      ) : (a.stage === "estimate" || reapprove) && !a.expired && !a.buyer_can_edit ? (
        <div style={{ ...muted, marginTop: 8 }}>To accept, open this quote from the link in your quote email.</div>
      ) : null}
    </div>
  );
}
