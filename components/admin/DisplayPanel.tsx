// components/admin/DisplayPanel.tsx
//
// Step 39D: "Display" on the admin quote page (boxes-only quotes with at
// least one part from a die line). Staff make the quote a display: number of
// displays, each part's name and how many go in one display, and (optional)
// this quote's assembly minutes or price per display. The "Assembly and
// packing" line is priced from the shop's rates (Pricing → Corrugated boxes →
// Displays and multi-part jobs). Backed by /api/admin/quotes/display.

// Step 39E2: on a display, this card is where the parts are worked on: each
// part's board grade, its die lines (Lines opens the die line reader in the
// row), Remove, "Add a part from a file", the quote's printing, and the
// buyer-upload check ("The lines look right"). The Boxes on this quote,
// Price from a die line and Customer requested cartons cards are hidden on
// a display to save room.
// Step 39G: each part can have its own printing (Printing column: "Quote's"
// or the part's own, Change opens an editor in the row).
// Step 39X: Made by: each part die cut + press, CAD cut + digital, or the
// quote's run method / auto by the part's own quantity (shown when the shop
// has short runs set up). Saving reprices the quote.
// Step 39X2: each part's Board, Printing and Made by sit on a line under the
// part, so the table fits the card (and scrolls inside it if it ever can't);
// a board grade with no cost per MSF is greyed out (unless
// the part already has it); a part with no price shows why under its row.
// Step 39Y: the assembly section says when it includes a top-up to the
// shop's minimum order (which now applies once to the whole display).

"use client";

import * as React from "react";
import DielineImportCard from "@/components/admin/DielineImportCard";
import { partRunDefaultLabel, partRunLabel } from "@/lib/dieline-import";

type Part = {
  id: number;
  label: string | null;
  filename: string | null;
  piece: number | null;
  per_display: number;
  qty: number;
  unit: number | null;
  extended: number | null;
  tooling: number | null;
  description: string | null;
  blank: { length_in: number; width_in: number; rule_in: number } | null;
  print?: Print | null; // Step 39G: own printing, null = the quote's
  run?: "plates" | "digital" | null; // Step 39X: own run, null = the quote's / auto
  run_used?: "plates" | "digital" | null; // Step 39X: what it's priced with now
  note?: string | null; // Step 39X2: the line's pricing note
};
type Print = { colors: ("spot" | "flood")[]; sides: 1 | 2 };
type Assembly = {
  id: number;
  unit: number | null;
  total: number | null;
  detail: {
    minutes_per_display?: number;
    breakdown?: { label: string; per_display: number }[];
    overridden?: boolean;
    min_topup_usd?: number; // Step 39Y
    min_order_usd?: number;
  } | null;
  override: { minutes_per_display?: number | null; usd_per_display?: number | null };
  needs_review: boolean;
  note: string | null;
};
type Info = {
  ok: true;
  boxes_only: boolean;
  locked: boolean;
  per_box: boolean;
  is_display: boolean;
  displays: number | null;
  parts: Part[];
  other_lines: { id: number; description: string | null; qty: number }[];
  assembly: Assembly | null;
  quote_print?: Print; // Step 39G
  quote_run?: "auto" | "plates" | "digital"; // Step 39X
  short_runs_on?: boolean;
  cutoff?: number;
};

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;
const card: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--surface-card)",
  padding: 16,
  marginBottom: 20,
};
const small: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
const input: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "2px 6px",
  fontSize: 12,
};
const btn: React.CSSProperties = { ...input, border: "1px solid var(--border-strong)", padding: "4px 10px", cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "var(--action-primary)", borderColor: "var(--action-primary)", color: "#fff" };

const printText = (pr: Print | null | undefined) =>
  pr && pr.colors.length
    ? `${pr.colors.length}-color (${pr.colors.join(", ")}), ${pr.sides === 2 ? "outside + inside" : "outside"}`
    : "No print";

/** Step 39G: colors (0-4), spot / flood for each, outside or outside + inside. */
function PrintEditor({
  initial,
  busy,
  saveLabel,
  onSave,
  onCancel,
  onUseQuote,
  testId,
}: {
  initial: Print;
  busy: boolean;
  saveLabel: string;
  onSave: (p: Print) => void;
  onCancel: () => void;
  onUseQuote?: () => void;
  testId: string;
}) {
  const [pr, setPr] = React.useState<Print>({ colors: [...initial.colors], sides: initial.sides });
  return (
    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }} data-print-editor={testId}>
      <label style={small}>
        Colors{" "}
        <select
          style={input}
          value={String(pr.colors.length)}
          onChange={(e) => {
            const n = Number(e.target.value);
            setPr((x) => ({ ...x, colors: Array.from({ length: n }, (_, i) => x.colors[i] ?? ("spot" as const)) }));
          }}
          aria-label="Print colors"
        >
          <option value="0">No print</option>
          <option value="1">1 color</option>
          <option value="2">2 colors</option>
          <option value="3">3 colors</option>
          <option value="4">4 colors</option>
        </select>
      </label>
      {pr.colors.map((c, i) => (
        <label key={i} style={small}>
          Color {i + 1}{" "}
          <select
            style={input}
            value={c}
            onChange={(e) => {
              const v: "spot" | "flood" = e.target.value === "flood" ? "flood" : "spot";
              setPr((x) => ({ ...x, colors: x.colors.map((y, j) => (j === i ? v : y)) }));
            }}
            aria-label={`Color ${i + 1} coverage`}
          >
            <option value="spot">Spot</option>
            <option value="flood">Flood</option>
          </select>
        </label>
      ))}
      {pr.colors.length ? (
        <label style={small}>
          Printed on{" "}
          <select
            style={input}
            value={String(pr.sides)}
            onChange={(e) => setPr((x) => ({ ...x, sides: e.target.value === "2" ? 2 : 1 }))}
            aria-label="Printed on"
          >
            <option value="1">Outside</option>
            <option value="2">Outside + inside</option>
          </select>
        </label>
      ) : null}
      <button type="button" style={primary} disabled={busy} onClick={() => onSave(pr)} data-print-save={testId}>
        {saveLabel}
      </button>
      {onUseQuote ? (
        <button type="button" style={btn} disabled={busy} onClick={onUseQuote} data-print-use-quote={testId}>
          Use the quote&apos;s printing
        </button>
      ) : null}
      <button type="button" style={btn} disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

type BoxRow = { id: number; L: number | null; W: number | null; style: string; grade_id: number | null; qty: number; colors: ("spot" | "flood")[]; sides: 1 | 2 };
type Grade = { id: number; name: string; is_default: boolean; priced?: boolean }; // Step 39X2

export default function DisplayPanel({ quoteNo }: { quoteNo: string }) {
  const [info, setInfo] = React.useState<Info | null>(null);
  const [displays, setDisplays] = React.useState("");
  const [parts, setParts] = React.useState<Record<number, { per: string; label: string }>>({});
  const [minutes, setMinutes] = React.useState("");
  const [perDisplayUsd, setPerDisplayUsd] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<number | null>(null); // Step 39D2
  // Step 39E2: grades, printing and die line checks, worked on here on a display
  const [boxRows, setBoxRows] = React.useState<BoxRow[]>([]);
  const [grades, setGrades] = React.useState<Grade[]>([]);
  const [toCheck, setToCheck] = React.useState<number[]>([]);
  const [openLines, setOpenLines] = React.useState<number | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [printEdit, setPrintEdit] = React.useState(false); // the quote's printing editor
  const [partPrintEdit, setPartPrintEdit] = React.useState<number | null>(null); // Step 39G: a part's printing editor

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/quotes/display?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Info) => {
        if (!alive || !j?.ok || !j.boxes_only) return;
        setInfo(j);
        setDisplays(String(j.displays ?? j.other_lines[0]?.qty ?? j.parts[0]?.qty ?? ""));
        setParts(Object.fromEntries(j.parts.map((p) => [p.id, { per: String(p.per_display), label: p.label ?? "" }])));
        setMinutes(j.assembly?.override.minutes_per_display != null ? String(j.assembly.override.minutes_per_display) : "");
        setPerDisplayUsd(j.assembly?.override.usd_per_display != null ? String(j.assembly.override.usd_per_display) : "");
      })
      .catch(() => {});
    // Step 39E2
    fetch(`/api/admin/quotes/boxes?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !j.boxes_only) return;
        setBoxRows(Array.isArray(j.rows) ? j.rows : []);
        setGrades(Array.isArray(j.grades) ? j.grades : []);
      })
      .catch(() => {});
    fetch(`/api/admin/quotes/dieline?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        const rows = (Array.isArray(j.rows) ? j.rows : []) as { id: number; dieline?: { check?: boolean } | null }[];
        setToCheck(rows.filter((r) => r.dieline?.check === true).map((r) => Number(r.id)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  if (!info || info.parts.length === 0) return null;

  const save = async (action: "start" | "update" | "stop") => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no: quoteNo,
          action,
          displays: Number(displays),
          parts: Object.entries(parts).map(([id, v]) => ({ id: Number(id), per_display: Number(v.per), label: v.label })),
          override: {
            minutes_per_display: minutes.trim() === "" ? null : Number(minutes),
            usd_per_display: perDisplayUsd.trim() === "" ? null : Number(perDisplayUsd),
          },
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Step 39D2: take one part off the display (two clicks: Remove, then Yes, remove).
  const removePart = async (id: number) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, action: "remove_part", part_id: id }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't remove the part (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Step 39E2: one part's board grade, or the quote's printing (saved on one part,
  // applies to the whole quote); same route as the Boxes card, quantity unchanged.
  const saveBox = async (row: BoxRow, patch: { grade_id?: number | null; colors?: ("spot" | "flood")[]; sides?: 1 | 2 }) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no: quoteNo,
          box_id: row.id,
          L: row.L,
          W: row.W,
          D: 0,
          style: row.style,
          qty: row.qty,
          grade_id: patch.grade_id !== undefined ? patch.grade_id : row.grade_id,
          colors: patch.colors ?? row.colors,
          sides: patch.sides ?? row.sides,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // Step 39E2: staff confirm the lines read from a buyer's upload
  const confirmLines = async () => {
    setBusy(true);
    setNote(null);
    try {
      const fd = new FormData();
      fd.set("quote_no", quoteNo);
      fd.set("mode", "confirm");
      const res = await fetch("/api/admin/quotes/dieline", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const boxOf = (id: number) => boxRows.find((r) => r.id === id) ?? null;
  // The quote's printing is saved through a part that uses it (Step 39G), else the first part.
  const printRow =
    info.parts.filter((p) => !p.print).map((p) => boxOf(p.id)).find(Boolean) ??
    info.parts.map((p) => boxOf(p.id)).find(Boolean) ??
    null;
  const quotePrint: Print = info.quote_print ?? (printRow ? { colors: printRow.colors, sides: printRow.sides } : { colors: [], sides: 1 });
  // Step 39G: a part's own printing (null = back to the quote's)
  const savePartPrint = async (id: number, pr: Print | null) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, action: "part_print", part_id: id, print: pr }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // Step 39X: how one part is made (null = the quote's / auto)
  const savePartRun = async (id: number, run: "plates" | "digital" | null) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, action: "part_run", part_id: id, run }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const workHere = info.is_display; // Step 39E2: the other cards are hidden on a display
  const madeBy = workHere && !!info.short_runs_on; // Step 39X
  // Step 39X2: board, printing and made by sit on a line under each part, so the table fits the card
  const cols = 6 + (!info.locked ? 1 : 0);
  const opt: React.CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", color: "var(--text-muted)" };

  const locked = info.locked;
  const asm = info.assembly;
  const digits = (v: string) => v.replace(/[^\d]/g, "").slice(0, 8);
  const decimal = (v: string) => v.replace(/[^\d.]/g, "").slice(0, 10);

  return (
    <div style={card} data-display-panel>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Display (multi-part job)</div>
      <div style={{ ...small, marginBottom: 10 }}>
        {info.is_display
          ? "This quote is a display: each part's quantity is the number of displays × how many go in one, and assembly and packing is its own line, priced from your rates in Pricing → Corrugated boxes → Displays and multi-part jobs."
          : "Several parts that go together, like a display? Make it a display to set how many of each part go in one, and add an assembly and packing line."}
      </div>

      {/* Step 39E2: the buyer uploaded this die line; staff confirm the reading */}
      {workHere && toCheck.length && !locked ? (
        <div
          style={{ marginBottom: 10, padding: 10, borderRadius: 8, border: "1px solid var(--attention-border)", background: "var(--attention-bg)", fontSize: 12 }}
          data-display-check
        >
          <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>The buyer uploaded this die line</div>
          <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>
            Its cut and crease lines were read automatically. Open Lines on a part to check it (saving confirms that part),
            or confirm them all. The quote stays in the review queue until then.
          </div>
          <button type="button" style={{ ...primary, marginTop: 6 }} disabled={busy} onClick={() => void confirmLines()} data-display-confirm>
            The lines look right ({toCheck.length} part{toCheck.length === 1 ? "" : "s"})
          </button>
        </div>
      ) : null}

      {info.per_box ? (
        <div style={small}>This quote prices each size with its own printing; displays use one print setting for the whole quote.</div>
      ) : (
        <>
          <label style={{ ...small, display: "inline-flex", gap: 6, alignItems: "center" }}>
            Number of displays
            <input
              style={{ ...input, width: 90 }}
              inputMode="numeric"
              value={displays}
              disabled={locked}
              onChange={(e) => setDisplays(digits(e.target.value))}
              aria-label="Number of displays"
              data-display-count
            />
          </label>

          <div style={{ overflowX: "auto", marginTop: 10 }} data-display-parts-wrap>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }} data-display-parts>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                <th style={{ padding: "4px 6px" }}>Part</th>
                <th style={{ padding: "4px 6px" }}>Blank (in)</th>
                <th style={{ padding: "4px 6px" }}>Per display</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Qty</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Each</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Total</th>
                {!locked ? <th style={{ padding: "4px 6px" }} /> : null}
              </tr>
            </thead>
            <tbody>
              {info.parts.map((p) => (
                <React.Fragment key={p.id}>
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      style={{ ...input, width: 110 }}
                      value={parts[p.id]?.label ?? ""}
                      placeholder={p.filename || "Part"}
                      disabled={locked}
                      onChange={(e) => setParts((x) => ({ ...x, [p.id]: { ...(x[p.id] ?? { per: "1", label: "" }), label: e.target.value.slice(0, 60) } }))}
                      aria-label="Part name"
                    />
                  </td>
                  <td style={{ padding: "4px 6px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {p.blank ? `${p.blank.length_in.toFixed(2)} × ${p.blank.width_in.toFixed(2)}` : "—"}
                    {toCheck.includes(p.id) ? <div style={{ ...small, color: "var(--attention)" }}>to check</div> : null}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      style={{ ...input, width: 56 }}
                      inputMode="numeric"
                      value={parts[p.id]?.per ?? "1"}
                      disabled={locked}
                      onChange={(e) => setParts((x) => ({ ...x, [p.id]: { ...(x[p.id] ?? { per: "1", label: "" }), per: digits(e.target.value).slice(0, 5) } }))}
                      aria-label="How many per display"
                      data-display-per={p.id}
                    />
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{p.qty.toLocaleString("en-US")}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    {p.unit == null ? <span style={{ color: "var(--attention)", whiteSpace: "nowrap" }}>No price</span> : usd(p.unit)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    {usd(p.extended)}
                    {p.tooling ? <div style={small}>+ {usd(p.tooling)} die</div> : null}
                  </td>
                  {!locked ? (
                    <td style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {workHere ? (
                        <>
                          <button
                            type="button"
                            style={btn}
                            disabled={busy}
                            onClick={() => {
                              setAdding(false);
                              setOpenLines(openLines === p.id ? null : p.id);
                            }}
                            data-display-lines={p.id}
                          >
                            {openLines === p.id ? "Hide lines" : "Lines"}
                          </button>{" "}
                        </>
                      ) : null}
                      {confirmRemove === p.id ? (
                        <>
                          <button type="button" style={btn} disabled={busy} onClick={() => void removePart(p.id)} data-display-remove-yes={p.id}>
                            Yes, remove
                          </button>{" "}
                          <button type="button" style={btn} disabled={busy} onClick={() => setConfirmRemove(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button type="button" style={btn} disabled={busy} onClick={() => setConfirmRemove(p.id)} data-display-remove={p.id}>
                          Remove
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
                {/* Step 39X2: the part's board, printing and how it's made, on its own line under the part */}
                {workHere ? (
                  <tr data-display-part-opts={p.id}>
                    <td colSpan={cols} style={{ padding: "0 6px 8px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "center", fontSize: 12 }}>
                      {workHere && grades.length ? (
                        <span style={opt}>
                          Board
                          {(() => {
                            const row = boxOf(p.id);
                            return (
                              <select
                                style={{ ...input, maxWidth: 200 }}
                                value={row?.grade_id != null ? String(row.grade_id) : ""}
                                disabled={locked || busy || !row}
                                onChange={(e) => {
                                  if (row) void saveBox(row, { grade_id: /^\d+$/.test(e.target.value) ? Number(e.target.value) : null });
                                }}
                                aria-label="Board grade"
                                data-display-grade={p.id}
                              >
                                <option value="">Shop default</option>
                                {grades.map((g) => (
                                  <option key={g.id} value={String(g.id)} disabled={g.priced === false && row?.grade_id !== g.id}>
                                    {g.name}
                                    {g.priced === false ? " (no price set)" : ""}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                        </span>
                      ) : null}
                      {/* Step 39G: the part's printing: the quote's, or its own */}
                      {workHere ? (
                        <span style={opt} data-display-part-print={p.id}>
                          Printing
                          {p.print ? (
                            <span style={{ color: "var(--text-primary)" }}>{printText(p.print)}</span>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>Quote&apos;s ({printText(quotePrint)})</span>
                          )}
                          {!locked ? (
                            <>
                              {" "}
                              <button
                                type="button"
                                style={{ ...btn, padding: "1px 6px" }}
                                disabled={busy}
                                onClick={() => {
                                  setOpenLines(null);
                                  setPartPrintEdit(partPrintEdit === p.id ? null : p.id);
                                }}
                                data-display-part-print-edit={p.id}
                              >
                                Change
                              </button>
                            </>
                          ) : null}
                        </span>
                      ) : null}
                      {/* Step 39X: how the part is made */}
                      {madeBy ? (
                        <span style={opt}>
                          Made by
                          <select
                            style={{ ...input, maxWidth: 200 }}
                            value={p.run ?? ""}
                            disabled={locked || busy}
                            onChange={(e) => {
                              const v = e.target.value;
                              void savePartRun(p.id, v === "plates" || v === "digital" ? v : null);
                            }}
                            aria-label="Made by"
                            data-display-part-run={p.id}
                          >
                            <option value="">{partRunDefaultLabel(info.quote_run, p.run ? null : p.run_used)}</option>
                            <option value="plates">{partRunLabel("plates")}</option>
                            <option value="digital">{partRunLabel("digital")}</option>
                          </select>
                        </span>
                      ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
                {/* Step 39X2: why a part has no price */}
                {p.unit == null && p.note ? (
                  <tr>
                    <td colSpan={cols} style={{ padding: "0 6px 6px", fontSize: 12, color: "var(--attention)" }} data-display-part-note={p.id}>
                      {p.note}
                    </td>
                  </tr>
                ) : null}
                {/* Step 39E2: the part's die lines, read and saved right here */}
                {partPrintEdit === p.id && !locked ? (
                  <tr>
                    <td colSpan={cols} style={{ padding: "0 6px 6px" }}>
                      <div style={small}>Printing for {parts[p.id]?.label || p.label || "this part"}</div>
                      <PrintEditor
                        initial={p.print ?? quotePrint}
                        busy={busy}
                        saveLabel="Save this part's printing"
                        onSave={(pr) => void savePartPrint(p.id, pr)}
                        onUseQuote={p.print ? () => void savePartPrint(p.id, null) : undefined}
                        onCancel={() => setPartPrintEdit(null)}
                        testId={`part-${p.id}`}
                      />
                    </td>
                  </tr>
                ) : null}
                {openLines === p.id ? (
                  <tr>
                    <td colSpan={cols} style={{ padding: "0 6px 6px" }}>
                      <DielineImportCard quoteNo={quoteNo} embedded={{ mode: "edit", boxId: p.id }} onClose={() => setOpenLines(null)} />
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          </div>
          {/* Step 39X */}
          {madeBy ? (
            <div style={{ ...small, marginTop: 4 }} data-display-run-hint>
              Made by: Auto uses your short-run cutoff on each part&apos;s own quantity
              {info.cutoff ? ` (under ${info.cutoff.toLocaleString("en-US")} = CAD cut + digital)` : ""}. Pick Die cut + press
              or CAD cut + digital to set a part yourself.
            </div>
          ) : workHere ? (
            <div style={{ ...small, marginTop: 4 }} data-display-run-hint>
              Every part is die cut. To CAD cut and digitally print short runs, set the short-run cutoff, CAD table rate and
              speed (Pricing → Corrugated boxes).
            </div>
          ) : null}

          {/* Step 39E2: the quote's printing and a new part, here instead of the other cards */}
          {workHere ? (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }} data-display-tools>
              <span style={{ color: "var(--text-secondary)" }}>
                {info.parts.some((p) => p.print) ? "Quote's printing (parts without their own)" : "Printing (all parts)"}:{" "}
                {printText(quotePrint)}
              </span>
              {!locked && printRow ? (
                <button type="button" style={btn} disabled={busy} onClick={() => setPrintEdit(!printEdit)} data-display-print>
                  {printEdit ? "Cancel" : "Change printing"}
                </button>
              ) : null}
              {!locked ? (
                <button
                  type="button"
                  style={btn}
                  disabled={busy}
                  onClick={() => {
                    setOpenLines(null);
                    setAdding(!adding);
                  }}
                  data-display-add
                >
                  {adding ? "Cancel adding" : "+ Add a part from a file"}
                </button>
              ) : null}
            </div>
          ) : null}
          {workHere && printEdit && printRow && !locked ? (
            <PrintEditor
              initial={quotePrint}
              busy={busy}
              saveLabel="Save printing"
              onSave={(pr) => void saveBox(printRow, { colors: pr.colors, sides: pr.sides })}
              onCancel={() => setPrintEdit(false)}
              testId="quote"
            />
          ) : null}
          {workHere && adding && !locked ? (
            <DielineImportCard quoteNo={quoteNo} embedded={{ mode: "add" }} onClose={() => setAdding(false)} />
          ) : null}
          {info.other_lines.length ? (
            <div style={{ ...small, marginTop: 6 }}>
              Other lines on this quote ({info.other_lines.map((l) => l.description || `line ${l.id}`).join("; ")}) are 1 per display.
            </div>
          ) : null}

          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-primary)" }} data-display-assembly>
            <div style={{ fontWeight: 600 }}>Assembly and packing</div>
            {asm ? (
              <div style={{ marginTop: 4 }}>
                {usd(asm.unit)} per display · {usd(asm.total)} total
                {asm.detail?.breakdown?.length ? (
                  <div style={small}>
                    {asm.detail.breakdown.map((x) => `${x.label} ${usd(x.per_display)}`).join(" + ")} per display, before markup
                  </div>
                ) : null}
                {/* Step 39Y: the minimum order, once for the whole display */}
                {asm.detail?.min_topup_usd ? (
                  <div style={small} data-display-min-topup>
                    Includes {usd(asm.detail.min_topup_usd)} to reach your {usd(asm.detail.min_order_usd ?? null)} minimum order (applied once to the
                    whole display: parts, dies and assembly).
                  </div>
                ) : null}
                {asm.note ? <div style={{ ...small, color: "var(--attention)" }}>{asm.note}</div> : null}
              </div>
            ) : (
              <div style={small}>Added when you make this a display.</div>
            )}
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <label style={small}>
                Labor minutes per display (this quote){" "}
                <input
                  style={{ ...input, width: 70 }}
                  inputMode="decimal"
                  value={minutes}
                  placeholder="shop rate"
                  disabled={locked}
                  onChange={(e) => setMinutes(decimal(e.target.value))}
                  aria-label="Labor minutes per display"
                  data-display-minutes
                />
              </label>
              <label style={small}>
                or price per display, before markup ($){" "}
                <input
                  style={{ ...input, width: 80 }}
                  inputMode="decimal"
                  value={perDisplayUsd}
                  placeholder="shop rate"
                  disabled={locked}
                  onChange={(e) => setPerDisplayUsd(decimal(e.target.value))}
                  aria-label="Assembly price per display"
                  data-display-usd
                />
              </label>
            </div>
          </div>

          {note ? <div style={{ marginTop: 8, fontSize: 12, color: "var(--attention)" }}>{note}</div> : null}

          {locked ? (
            <div style={{ ...small, marginTop: 10 }}>Released quote: use Revise to change it.</div>
          ) : (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={primary}
                disabled={busy || !/^\d+$/.test(displays) || Number(displays) < 1}
                onClick={() => void save(info.is_display ? "update" : "start")}
                data-display-save
              >
                {info.is_display ? "Save and reprice" : "Make this a display"}
              </button>
              {info.is_display ? (
                <button type="button" style={btn} disabled={busy} onClick={() => void save("stop")} data-display-stop>
                  Not a display
                </button>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
