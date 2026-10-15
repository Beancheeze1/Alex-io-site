// components/admin/QuoteApprovalPanel.tsx
//
// Step 28: the shop's side of estimate -> accepted -> confirmed on the admin
// quote page (GET/POST /api/admin/quotes/approval):
//   - where the quote stands, who accepted it (PO) and at what total
//   - Confirm (when the buyer accepted the current price), or record the
//     buyer's approval for them and confirm (PO by email, phone, ...)
//   - Undo confirmation
//   - Expiry date and lead time for this quote (blank = shop default)
//   - Step 29A: "Email the buyer" on confirm, "Email buyer to re-approve"
//     when the price changed, and the list of emails sent for this quote

"use client";

import * as React from "react";

type Approval = {
  stage: "estimate" | "accepted" | "needs_reapproval" | "confirmed";
  current_total: number;
  accepted: { at: string; name: string | null; po: string | null; total: number; by_staff: boolean } | null;
  confirmed: { at: string; by: string | null; total: number } | null;
  expires_at: string | null;
  expires_override: boolean;
  expired: boolean;
  lead_time: string | null;
  lead_time_override: boolean;
};

type EmailRow = {
  id: number;
  kind: string;
  to_email: string | null;
  status: string;
  detail: string | null;
  created_by: string | null;
  created_at: string;
};

const EMAIL_KIND: Record<string, string> = {
  quote: "Quote",
  accepted: "Approval received",
  confirmed: "Order confirmed",
  reapprove: "Please re-approve",
  released: "In production",
  expiring: "Expires soon (reminder)",
  followup: "Follow-up (reminder)",
  proof: "Proof ready",
};

const STAGE: Record<Approval["stage"], string> = {
  estimate: "Estimate (not accepted yet)",
  accepted: "Accepted by the buyer: ready to confirm",
  needs_reapproval: "Price changed since the buyer accepted: needs re-approval",
  confirmed: "Confirmed",
};

const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
};
const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
};
const ymd = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

const btn: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "4px 8px",
  fontSize: 12,
};

export default function QuoteApprovalPanel({ quoteNo }: { quoteNo: string }) {
  const [a, setA] = React.useState<Approval | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [noteOk, setNoteOk] = React.useState(false);
  const [emails, setEmails] = React.useState<EmailRow[]>([]);
  const [buyerEmail, setBuyerEmail] = React.useState<string | null>(null);
  const [notify, setNotify] = React.useState(true);
  const [buyerName, setBuyerName] = React.useState("");
  const [po, setPo] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [lead, setLead] = React.useState("");

  const mail = (j: { emails?: EmailRow[]; buyer_email?: string | null } | null) => {
    const list = j?.emails;
    setEmails(Array.isArray(list) ? list : []);
    setBuyerEmail(j?.buyer_email || null);
  };

  const apply = (next: Approval | null) => {
    setA(next);
    setExpiry(next?.expires_override ? ymd(next.expires_at) : "");
    setLead(next?.lead_time_override ? next.lead_time || "" : "");
  };

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/quotes/approval?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok) {
          apply(j.approval);
          mail(j);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  const post = async (body: Record<string, unknown>, reload = false) => {
    setBusy(true);
    setNote(null);
    setNoteOk(false);
    try {
      const res = await fetch("/api/admin/quotes/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, ...body }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      if (reload) {
        window.location.reload();
        return;
      }
      apply(j.approval);
      mail(j);
      setNoteOk(true);
      setNote(body.action === "email_reapprove" ? `Email sent to ${j.email?.to || "the buyer"}.` : "Saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!a) return null;
  const needsBuyer = a.stage === "estimate" || a.stage === "needs_reapproval";
  const canConfirm = a.stage === "accepted" || (needsBuyer && a.current_total > 0);

  return (
    <div
      data-approval-panel={a.stage}
      style={{ marginBottom: 10, padding: 10, borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}
    >
      <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Approval: {STAGE[a.stage]}</div>
      <div>Quote total now {usd(a.current_total)}.</div>
      {a.accepted ? (
        <div>
          Accepted by {a.accepted.name || "buyer"} on {day(a.accepted.at)}
          {a.accepted.po ? ` · PO ${a.accepted.po}` : ""} at {usd(a.accepted.total)}
          {a.accepted.by_staff ? " (recorded by staff)" : ""}.
        </div>
      ) : null}
      {a.confirmed ? (
        <div>
          Confirmed by {a.confirmed.by || "staff"} on {day(a.confirmed.at)} at {usd(a.confirmed.total)}.
        </div>
      ) : null}
      {a.stage !== "confirmed" ? (
        <div style={a.expired ? { color: "var(--attention)" } : undefined}>
          {a.expires_at ? `${a.expired ? "Expired" : "Valid until"} ${day(a.expires_at)}` : "No expiry"}
          {a.expires_override ? " (set on this quote)" : " (shop default)"}.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        {a.stage === "accepted" ? (
          <button type="button" style={btn} disabled={busy} data-confirm-quote onClick={() => post({ action: "confirm", notify_buyer: notify }, true)}>
            Confirm order at {usd(a.current_total)}
          </button>
        ) : null}
        {needsBuyer && a.current_total > 0 ? (
          <>
            <input style={input} aria-label="Approved by" placeholder="Approved by (buyer name)" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            <input style={{ ...input, width: 120 }} aria-label="PO" placeholder="PO (optional)" value={po} onChange={(e) => setPo(e.target.value)} />
            <button
              type="button"
              style={btn}
              disabled={busy || !buyerName.trim()}
              data-record-and-confirm
              onClick={() => post({ action: "confirm", buyer_name: buyerName, po, notify_buyer: notify }, true)}
            >
              Record buyer approval + confirm
            </button>
          </>
        ) : null}
        {a.stage === "needs_reapproval" && buyerEmail ? (
          <button type="button" style={btn} disabled={busy} data-email-reapprove onClick={() => post({ action: "email_reapprove" })}>
            Email buyer to re-approve
          </button>
        ) : null}
        {a.confirmed ? (
          <button type="button" style={btn} disabled={busy} data-unconfirm onClick={() => post({ action: "unconfirm" }, true)}>
            Undo confirmation
          </button>
        ) : null}
      </div>

      {canConfirm ? (
        <div style={{ marginTop: 6 }} data-notify-buyer>
          {buyerEmail ? (
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" aria-label="Email the buyer" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Email the buyer ({buyerEmail}) when I confirm
            </label>
          ) : (
            <span>No buyer email on this quote, so no emails are sent.</span>
          )}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <label>
          Expires{" "}
          <input type="date" style={input} aria-label="Expiry date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
        <button type="button" style={btn} disabled={busy} data-save-expiry onClick={() => post({ action: "expiry", expires_on: expiry || null })}>
          {expiry ? "Set expiry" : "Use shop default"}
        </button>
        <label>
          Lead time{" "}
          <input
            style={{ ...input, width: 200 }}
            aria-label="Lead time"
            maxLength={120}
            placeholder={a.lead_time && !a.lead_time_override ? `Shop default: ${a.lead_time}` : "Shop default"}
            value={lead}
            onChange={(e) => setLead(e.target.value)}
          />
        </label>
        <button type="button" style={btn} disabled={busy} data-save-lead onClick={() => post({ action: "lead_time", lead_time: lead.trim() ? lead : null })}>
          Save lead time
        </button>
      </div>
      {note ? <div style={{ marginTop: 6, color: noteOk ? "var(--status-success-text)" : "var(--attention)" }}>{note}</div> : null}

      {emails.length ? (
        <div style={{ marginTop: 8 }} data-quote-emails>
          <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Emails to the buyer</div>
          {emails.map((m) => (
            <div key={m.id} data-quote-email={m.kind} data-email-status={m.status}>
              {when(m.created_at)} · {EMAIL_KIND[m.kind] || m.kind}
              {m.to_email ? ` to ${m.to_email}` : ""} ·{" "}
              <span style={{ color: m.status === "sent" ? "var(--status-success-text)" : m.status === "failed" ? "var(--attention)" : undefined }}>
                {m.status === "sent" ? "sent" : m.status === "failed" ? "failed" : "not sent"}
              </span>
              {m.detail ? ` (${m.detail})` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
