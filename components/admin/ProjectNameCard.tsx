// components/admin/ProjectNameCard.tsx
//
// Step 50: the quote's project name on the admin quote page (Client & specs),
// with Edit. Staff can set it on any quote, released ones too (it's for
// finding the quote, not a price change). Saved through
// /api/admin/quotes/project-name; blank clears it.

"use client";

import * as React from "react";

export default function ProjectNameCard({
  quoteNo,
  initial,
  labelStyle,
  onSaved,
}: {
  quoteNo: string;
  initial: string | null;
  labelStyle: React.CSSProperties;
  onSaved?: (name: string | null) => void;
}) {
  const [name, setName] = React.useState<string | null>(initial);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initial ?? "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setName(initial);
    setDraft(initial ?? "");
  }, [initial]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/quotes/project-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, project_name: draft }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setErr(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      setName(j.project_name ?? null);
      setDraft(j.project_name ?? "");
      setEditing(false);
      onSaved?.(j.project_name ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const btn: React.CSSProperties = {
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    padding: "2px 8px",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <div data-admin-project-name>
      <div style={labelStyle}>Project</div>
      {editing ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={draft}
            maxLength={80}
            autoFocus
            placeholder="e.g. Kroger endcap"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(name ?? "");
              }
            }}
            aria-label="Project name"
            data-admin-project-input
            style={{
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              padding: "3px 8px",
              fontSize: 13,
              minWidth: 220,
            }}
          />
          <button
            type="button"
            style={{ ...btn, background: "var(--action-primary)", borderColor: "var(--action-primary)", color: "#fff" }}
            disabled={busy}
            onClick={() => void save()}
            data-admin-project-save
          >
            Save
          </button>
          <button
            type="button"
            style={btn}
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setDraft(name ?? "");
              setErr(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {name ? <span data-admin-project-value>{name}</span> : <span style={{ color: "var(--text-faint)" }}>None yet.</span>}
          <button type="button" style={btn} onClick={() => setEditing(true)} data-admin-project-edit>
            {name ? "Edit" : "Add project name"}
          </button>
        </div>
      )}
      {err ? <div style={{ fontSize: 12, color: "var(--attention)", marginTop: 2 }}>{err}</div> : null}
    </div>
  );
}
