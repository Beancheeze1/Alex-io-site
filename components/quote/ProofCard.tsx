// components/quote/ProofCard.tsx
//
// Step 31: artwork proofs on the quote page (buyer) and the admin quote page
// (staff). Loads GET /api/quote/proofs.
//   Buyer (edit link): approve the newest proof (name + "I've checked"), or
//   request changes (comment + optional marked-up file).
//   Staff: send a proof (file + note, email the buyer), record the buyer's
//   approval for them, and see every version with its answer.

"use client";

import * as React from "react";

type ProofFile = { id: number; filename: string; content_type: string | null; url: string };
type Proof = {
  version: number;
  status: "sent" | "approved" | "changes" | "superseded";
  note: string | null;
  sent_at: string;
  sent_by: string | null;
  file: ProofFile | null;
  response: { at: string; name: string | null; comment: string | null; by_staff: boolean; file: ProofFile | null } | null;
};
type Summary = {
  required: boolean;
  stage: "none" | "waiting" | "approved" | "changes";
  latest_version: number | null;
  versions: Proof[];
  locked: boolean;
};

const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
};

const STATUS: Record<Proof["status"], string> = {
  sent: "waiting for approval",
  approved: "approved",
  changes: "changes requested",
  superseded: "replaced",
};

export default function ProofCard({ quoteNo, canEdit, staff = false }: { quoteNo: string; canEdit: boolean; staff?: boolean }) {
  const [s, setS] = React.useState<Summary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [markup, setMarkup] = React.useState<File | null>(null);
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
  const [notify, setNotify] = React.useState(true);
  const [mode, setMode] = React.useState<"approve" | "changes">("approve");

  const load = React.useCallback(() => {
    fetch(`/api/quote/proofs?quote_no=${encodeURIComponent(quoteNo)}&t=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setS(j as Summary);
      })
      .catch(() => {});
  }, [quoteNo]);
  React.useEffect(load, [load]);

  if (!s) return null;
  if (!staff && s.versions.length === 0 && !s.required) return null;

  const latest = s.versions.find((v) => v.version === s.latest_version) || null;
  const older = s.versions.filter((v) => v.version !== s.latest_version);
  const waiting = s.stage === "waiting" && !!latest && !s.locked;

  const send = async (url: string, fd: FormData, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setMsg({ ok: false, text: j?.message || `Couldn't save (HTTP ${res.status}).` });
        return;
      }
      setS(j as Summary);
      setMsg({ ok: true, text: okText });
      setName("");
      setAgree(false);
      setComment("");
      setMarkup(null);
      setProofFile(null);
      setNote("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const respond = (action: "approve" | "changes") => {
    if (!latest) return;
    const fd = new FormData();
    fd.set("quote_no", quoteNo);
    fd.set("version", String(latest.version));
    fd.set("action", action);
    fd.set("name", name);
    fd.set("agree", agree ? "true" : "");
    fd.set("comment", comment);
    if (markup) fd.set("file", markup);
    void send("/api/quote/proofs", fd, action === "approve" ? "Proof approved. Thank you." : "Thanks, we'll send a new proof.");
  };

  const upload = () => {
    if (!proofFile) return;
    const fd = new FormData();
    fd.set("quote_no", quoteNo);
    fd.set("file", proofFile);
    fd.set("note", note);
    fd.set("notify", notify ? "true" : "false");
    void send("/api/admin/quotes/proofs", fd, notify ? "Proof sent and the buyer emailed." : "Proof saved (no email).");
  };

  const box: React.CSSProperties = {
    borderRadius: staff ? 8 : 16,
    border: `1px solid ${s.stage === "approved" ? "var(--status-success-text)" : s.stage === "changes" ? "var(--attention)" : "var(--border)"}`,
    background: "var(--surface-card)",
    padding: staff ? 10 : "12px 14px",
    marginTop: 4,
    fontSize: staff ? 12 : 13,
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
  const muted: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };

  const fileLink = (f: ProofFile | null, label: string) =>
    f ? (
      <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
        {label} ({f.filename})
      </a>
    ) : null;

  const title =
    s.stage === "none"
      ? staff
        ? s.required
          ? "Proof: none sent yet (this quote prints, so a proof is expected)"
          : "Proof: none sent"
        : "Proof: the shop will send a proof before production"
      : s.stage === "waiting"
        ? `Proof v${s.latest_version}: waiting for ${staff ? "the buyer's" : "your"} approval`
        : s.stage === "approved"
          ? `Proof v${s.latest_version}: approved`
          : `Proof v${s.latest_version}: changes requested`;

  return (
    <div style={box} data-proof-card={s.stage}>
      <div style={{ fontWeight: 600, fontSize: staff ? 12 : 14, color: "var(--text-primary)", marginBottom: 4 }}>{title}</div>

      {latest ? (
        <div data-proof-latest={latest.version}>
          <div>{fileLink(latest.file, `Open proof v${latest.version}`)}</div>
          {latest.file && /^image\/(png|jpeg)$/.test(latest.file.content_type || "") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={latest.file.url} alt={`Proof v${latest.version}`} style={{ maxWidth: "100%", maxHeight: 360, marginTop: 6, border: "1px solid var(--border)", borderRadius: 6 }} />
          ) : null}
          <div style={muted}>Sent {day(latest.sent_at)}{staff && latest.sent_by ? ` by ${latest.sent_by}` : ""}.</div>
          {latest.note ? <div style={{ marginTop: 4 }}>Note from the shop: {latest.note}</div> : null}
          {latest.response ? (
            <div style={{ marginTop: 4 }} data-proof-response>
              {latest.status === "approved"
                ? `Approved by ${latest.response.name || "the buyer"} on ${day(latest.response.at)}${latest.response.by_staff ? " (recorded by the shop)" : ""}.`
                : `Changes requested on ${day(latest.response.at)}: ${latest.response.comment || ""}`}
              {latest.response.file ? <div>{fileLink(latest.response.file, "Marked-up file")}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {waiting && canEdit && !staff ? (
        <div style={{ marginTop: 10 }} data-proof-answer>
          <div style={{ display: "flex", gap: 12, fontSize: 13, color: "var(--text-primary)" }}>
            <label>
              <input type="radio" name={`proof-${quoteNo}`} data-proof-mode="approve" checked={mode === "approve"} onChange={() => setMode("approve")} />{" "}
              Approve
            </label>
            <label>
              <input type="radio" name={`proof-${quoteNo}`} data-proof-mode="changes" checked={mode === "changes"} onChange={() => setMode("changes")} />{" "}
              Request changes
            </label>
          </div>
          {mode === "approve" ? (
            <div style={{ marginTop: 6 }}>
              <input style={input} aria-label="Your name" placeholder="Your name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <label style={{ display: "flex", gap: 8, marginTop: 6, color: "var(--text-primary)" }}>
                <input type="checkbox" aria-label="I've checked the proof" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I&apos;ve checked the spelling, colors, sizes and layout. Print it as shown.</span>
              </label>
              <button type="button" data-proof-approve style={btn(true)} disabled={busy || !agree || !name.trim()} onClick={() => respond("approve")}>
                Approve proof v{latest?.version}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <textarea
                style={{ ...input, minHeight: 80 }}
                aria-label="What should change"
                placeholder="What should change?"
                value={comment}
                maxLength={2000}
                onChange={(e) => setComment(e.target.value)}
              />
              <div style={{ ...muted, marginTop: 4 }}>Marked-up file (optional, PDF or image, up to 8 MB)</div>
              <input type="file" aria-label="Marked-up file" onChange={(e) => setMarkup(e.target.files?.[0] || null)} />
              <div>
                <button type="button" data-proof-changes style={btn(true)} disabled={busy || !comment.trim()} onClick={() => respond("changes")}>
                  Send changes
                </button>
              </div>
            </div>
          )}
        </div>
      ) : waiting && !canEdit && !staff ? (
        <div style={{ ...muted, marginTop: 6 }}>To approve, open this quote from the link in your email.</div>
      ) : null}

      {staff && !s.locked ? (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }} data-proof-send>
          <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Send {latest ? "a new" : "a"} proof</div>
          <input type="file" aria-label="Proof file" onChange={(e) => setProofFile(e.target.files?.[0] || null)} />
          <textarea
            style={{ ...input, minHeight: 50, marginTop: 6 }}
            aria-label="Note to the buyer"
            placeholder="Note to the buyer (optional)"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <input type="checkbox" aria-label="Email the buyer" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email the buyer that the proof is ready
          </label>
          <button type="button" data-proof-upload style={btn(true)} disabled={busy || !proofFile} onClick={upload}>
            Send proof v{(s.latest_version || 0) + 1}
          </button>
          {waiting ? (
            <div style={{ marginTop: 8 }}>
              <div style={muted}>Buyer approved by email or phone? Record it:</div>
              <input style={{ ...input, maxWidth: 260 }} aria-label="Approved by" placeholder="Approved by (buyer name)" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <button
                type="button"
                data-proof-record
                style={btn(false)}
                disabled={busy || !name.trim()}
                onClick={() => {
                  setAgree(true);
                  if (!latest) return;
                  const fd = new FormData();
                  fd.set("quote_no", quoteNo);
                  fd.set("version", String(latest.version));
                  fd.set("action", "approve");
                  fd.set("name", name);
                  fd.set("agree", "true");
                  void send("/api/quote/proofs", fd, "Approval recorded.");
                }}
              >
                Record approval of v{latest?.version}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {msg ? <div style={{ ...muted, marginTop: 6, color: msg.ok ? "var(--status-success-text)" : "var(--attention)" }}>{msg.text}</div> : null}

      {older.length ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", ...muted }}>Earlier proofs ({older.length})</summary>
          {older.map((p) => (
            <div key={p.version} style={{ marginTop: 4 }} data-proof-old={p.version}>
              {fileLink(p.file, `v${p.version}`)} · {STATUS[p.status]} · sent {day(p.sent_at)}
              {p.response?.comment ? ` · "${p.response.comment}"` : ""}
              {p.response?.file ? <> · {fileLink(p.response.file, "markup")}</> : null}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}
