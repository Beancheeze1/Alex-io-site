// components/admin/AddNoteBox.tsx
//
// Step 39V: "Add a note" under a quote's internal notes (quotes list Notes row
// and the admin quote page). Saves through POST /api/admin/quotes/internal-notes,
// which adds a dated, signed line; onSaved gets the updated notes.

"use client";

import * as React from "react";
import { NOTE_MAX } from "@/app/lib/internal-notes-core";

export default function AddNoteBox({ quoteNo, onSaved }: { quoteNo: string; onSaved: (notes: string | null) => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/quotes/internal-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, note: text }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setMsg({ ok: false, text: j?.message || "Couldn't save the note." });
        return;
      }
      setText("");
      setMsg({ ok: true, text: "Note added." });
      onSaved(typeof j.internal_notes === "string" ? j.internal_notes : null);
    } catch {
      setMsg({ ok: false, text: "Couldn't save the note." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2" data-add-note>
      <textarea
        aria-label="Add an internal note"
        rows={2}
        maxLength={NOTE_MAX}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (msg) setMsg(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="Add a note for the team (not shown to the customer)"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !text.trim()}
          className="inline-flex items-center rounded-full border border-[var(--action-primary)] bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          data-add-note-save
        >
          {busy ? "Saving…" : "Add note"}
        </button>
        <span className="text-[10px] text-[var(--text-faint)]">Saved with today&apos;s date and your name.</span>
        {msg ? (
          <span className={`text-[11px] ${msg.ok ? "text-[var(--status-success-text)]" : "text-[var(--attention)]"}`}>{msg.text}</span>
        ) : null}
      </div>
    </div>
  );
}
