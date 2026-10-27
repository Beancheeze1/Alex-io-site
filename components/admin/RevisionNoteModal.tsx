// components/admin/RevisionNoteModal.tsx
//
// Step 44d: the Revise box. Before a quote is revised (quotes list Revise /
// Unlock & revise, admin quote page Revise) staff type a short description
// and the reviser's initials (filled in from their name). They show in the
// revision block on the 3-view PDF drawings. "Revise without a note" keeps the
// old behavior: the drawing works out a description from what changed.

"use client";

import * as React from "react";
import { REV_BY_MAX, REV_DESC_MAX, cleanRevBy, cleanRevDescription, initialsOf } from "@/lib/revision-notes";

export type RevisionNoteInput = { description: string; by: string };

/** Save the note for the quote's next revision (call after the quote is unlocked). */
export async function saveRevisionNote(quoteNo: string, note: RevisionNoteInput): Promise<{ ok: true; revision: string } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/admin/quotes/revision-note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote_no: quoteNo, description: note.description, by: note.by }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) return { ok: false, message: j?.message || "Couldn't save the revision note." };
    return { ok: true, revision: String(j.revision || "") };
  } catch {
    return { ok: false, message: "Couldn't save the revision note." };
  }
}

export default function RevisionNoteModal({
  quoteNo,
  onCancel,
  onRevise,
}: {
  quoteNo: string;
  onCancel: () => void;
  onRevise: (note: RevisionNoteInput | null) => void; // null = revise without a note
}) {
  const [description, setDescription] = React.useState("");
  const [by, setBy] = React.useState("");
  const byTouched = React.useRef(false);

  // the reviser's initials from their name (they can change them)
  React.useEffect(() => {
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (live && !byTouched.current) setBy(initialsOf(j?.user));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const d = cleanRevDescription(description);
  const b = cleanRevBy(by);
  const ready = !!d && !!b;
  const submit = () => {
    if (ready) onRevise({ description: d, by: b });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rev-note-title"
      data-revision-note
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5 shadow-xl">
        <div id="rev-note-title" className="text-base font-semibold text-[var(--text-primary)]">
          Revise {quoteNo}
        </div>
        <div className="mt-1 text-sm text-[var(--text-secondary)]">
          What is changing? This goes in the revision block on the drawings.
        </div>

        <label className="mt-4 block text-xs font-medium text-[var(--text-muted)]" htmlFor="rev-note-desc">
          Description
        </label>
        <input
          id="rev-note-desc"
          autoFocus
          maxLength={REV_DESC_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Added finger slots to pocket 1"
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]"
          data-revision-note-desc
        />
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
          Keep it short: about 40 characters fit on the drawing. {description.length}/{REV_DESC_MAX}
        </div>

        <label className="mt-3 block text-xs font-medium text-[var(--text-muted)]" htmlFor="rev-note-by">
          Revised by (initials)
        </label>
        <input
          id="rev-note-by"
          maxLength={REV_BY_MAX}
          value={by}
          onChange={(e) => {
            byTouched.current = true;
            setBy(cleanRevBy(e.target.value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className="mt-1 w-24 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-sm uppercase text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
          data-revision-note-by
        />

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onRevise(null)}
            className="mr-auto text-xs text-[var(--text-secondary)] underline"
            data-revision-note-skip
          >
            Revise without a note
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
            data-revision-note-cancel
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="rounded-md border border-[var(--action-primary)] bg-[var(--action-primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            data-revision-note-save
          >
            Revise
          </button>
        </div>
      </div>
    </div>
  );
}
