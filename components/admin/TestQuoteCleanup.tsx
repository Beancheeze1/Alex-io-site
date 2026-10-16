// components/admin/TestQuoteCleanup.tsx
//
// Step 36B: "Test quotes" tab on /admin/cleanup (platform owner only).
// Paste quote numbers -> Preview (dry run: quotes, rows per table, rows that
// stay, money records that block) -> type the confirm phrase -> Delete.
// POST /api/admin/cleanup/test-quotes.

"use client";

import * as React from "react";
import type { Preview } from "@/app/lib/test-cleanup-core";

type Deleted = { quotes: number; rows: { table: string; rows: number }[] };

export default function TestQuoteCleanup() {
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState<"preview" | "delete" | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Deleted | null>(null);

  async function call(apply: boolean) {
    setBusy(apply ? "delete" : "preview");
    setErr(null);
    if (!apply) setDone(null);
    try {
      const r = await fetch("/api/admin/cleanup/test-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apply ? { quote_nos: text, apply: true, confirm: typed } : { quote_nos: text }),
      });
      const j = (await r.json().catch(() => null)) as
        | { ok?: boolean; message?: string; preview?: Preview; deleted?: Deleted }
        | null;
      if (j?.preview) setPreview(j.preview);
      if (!r.ok || !j?.ok) {
        setErr(j?.message || `Failed (HTTP ${r.status}).`);
        return;
      }
      if (apply && j.deleted) {
        setDone(j.deleted);
        setPreview(null);
        setTyped("");
        setText("");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  const th = "border-b border-[var(--border)] px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
  const td = "border-b border-[var(--border)] px-2 py-1";
  const btn =
    "rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50";
  const n = preview?.quotes.length || 0;
  const canDelete = !!preview && n > 0 && preview.blocked.length === 0 && typed.trim().toUpperCase() === preview.confirm;

  const tableList = (rows: { table: string; rows: number }[], attr: string) => (
    <ul className="mt-1 space-y-0.5 text-xs" data-cleanup-list={attr}>
      {rows.map((t) => (
        <li key={t.table} className="flex justify-between gap-4 tabular-nums">
          <span className="font-mono">{t.table}</span>
          <span>{t.rows}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4" data-test-cleanup>
      <div className="text-xs text-[var(--text-secondary)]">
        Delete QA test quotes by number, with everything attached to them (items, boxes, layouts, proofs, emails, facts, alerts).
        Released quotes can be deleted here. Quotes with commission or expense records are refused.
      </div>

      <textarea
        className="h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2 font-mono text-xs text-[var(--text-primary)]"
        placeholder={"Q-A-261015-21477\nQ-R-261016-91927, …"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setTyped("");
        }}
        data-cleanup-input
      />
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={!text.trim() || busy !== null} onClick={() => call(false)} data-cleanup-preview>
          {busy === "preview" ? "Checking…" : "Preview (dry run)"}
        </button>
        {err ? (
          <span className="text-xs text-[var(--attention)]" role="alert" data-cleanup-error>
            {err}
          </span>
        ) : null}
      </div>

      {done ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-3 text-xs" role="status" data-cleanup-done>
          Deleted {done.quotes} quote{done.quotes === 1 ? "" : "s"} and {done.rows.reduce((s, r) => s + r.rows, 0)} attached rows.
          {tableList(done.rows, "deleted")}
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-3" data-cleanup-result>
          {preview.not_found.length ? (
            <div className="text-xs text-[var(--attention)]" data-cleanup-notfound>
              Not found: {preview.not_found.join(", ")}
            </div>
          ) : null}
          {preview.invalid.length ? (
            <div className="text-xs text-[var(--attention)]">Not quote numbers: {preview.invalid.join(", ")}</div>
          ) : null}

          {n ? (
            <table className="w-full text-xs" data-cleanup-quotes>
              <thead>
                <tr>
                  <th className={th}>Quote</th>
                  <th className={th}>Shop</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {preview.quotes.map((q) => (
                  <tr key={q.quote_no} data-cleanup-quote={q.quote_no}>
                    <td className={`${td} font-mono`}>
                      {q.quote_no}
                      {q.reorders.length ? (
                        <div className="text-[10px] text-[var(--text-muted)]">Reordered as {q.reorders.join(", ")} (kept)</div>
                      ) : null}
                    </td>
                    <td className={td}>{q.shop || q.tenant_id}</td>
                    <td className={td}>{q.customer || "—"}</td>
                    <td className={td}>
                      {q.status || "—"}
                      {q.locked ? " · released" : ""}
                    </td>
                    <td className={td}>{new Date(q.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">No matching quotes.</div>
          )}

          {preview.tables.length ? (
            <div>
              <div className="text-xs font-semibold">Rows that will be deleted</div>
              {tableList(preview.tables, "delete")}
            </div>
          ) : null}
          {preview.kept.length ? (
            <div>
              <div className="text-xs font-semibold">Rows that point at these quotes but stay</div>
              {tableList(preview.kept, "kept")}
            </div>
          ) : null}
          {preview.blocked.length ? (
            <div className="text-xs text-[var(--attention)]" data-cleanup-blocked>
              <div className="font-semibold">Money records: remove these quotes from the list to continue</div>
              {tableList(preview.blocked, "blocked")}
            </div>
          ) : null}

          {n && !preview.blocked.length ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
              <label className="text-xs text-[var(--text-secondary)]">
                Type <span className="font-mono font-semibold">{preview.confirm}</span> to confirm
                <input
                  className="ml-2 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 font-mono text-xs"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  data-cleanup-confirm
                />
              </label>
              <button
                type="button"
                disabled={!canDelete || busy !== null}
                onClick={() => call(true)}
                className="rounded-md bg-[var(--attention)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                data-cleanup-delete
              >
                {busy === "delete" ? "Deleting…" : `Delete ${n} quote${n === 1 ? "" : "s"} permanently`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
