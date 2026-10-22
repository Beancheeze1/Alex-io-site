// components/admin/BoxEditPanel.tsx
//
// Step 18: "Boxes on this quote" on the admin quote page, for boxes-only
// quotes. Boxes-only quotes have no layout editor, so after Revise this is
// where staff change a box's inside size, style, board grade, printing and
// quantity. Saving reprices that box (GET/POST /api/admin/quotes/boxes) and
// reloads the page. Released quotes are read-only until revised.

"use client";

import * as React from "react";
import { BOX_STYLES, boxStyleInfo, boxStyleOrRsc, type BoxStyle } from "@/lib/box-styles";

type Coverage = "spot" | "flood";

type Row = {
  id: number;
  kind: "stock" | "custom";
  sku: string | null;
  description: string | null;
  L: number | null;
  W: number | null;
  D: number | null;
  style: BoxStyle; // Step 27: any style
  cells_across?: number | null;
  cells_down?: number | null;
  grade_id: number | null;
  qty: number;
  colors: Coverage[];
  sides: 1 | 2;
};

type Grade = { id: number; name: string; is_default: boolean };

type Draft = {
  L: string;
  W: string;
  D: string;
  style: BoxStyle;
  cellsA: string;
  cellsD: string;
  gradeId: string;
  qty: string;
  colors: Coverage[];
  sides: 1 | 2;
};

function toDraft(r: Row): Draft {
  return {
    L: r.L == null ? "" : String(r.L),
    W: r.W == null ? "" : String(r.W),
    D: r.D == null ? "" : String(r.D),
    style: boxStyleOrRsc(r.style),
    cellsA: r.cells_across == null ? "2" : String(r.cells_across),
    cellsD: r.cells_down == null ? "2" : String(r.cells_down),
    gradeId: r.grade_id == null ? "" : String(r.grade_id),
    qty: String(r.qty),
    colors: [...r.colors],
    sides: r.sides,
  };
}

const input: React.CSSProperties = {
  width: "100%",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "5px 8px",
  fontSize: 12,
};
const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 3,
};
const btn: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
};

export default function BoxEditPanel({ quoteNo }: { quoteNo: string }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [grades, setGrades] = React.useState<Grade[]>([]);
  const [locked, setLocked] = React.useState(false);
  const [perBox, setPerBox] = React.useState(false);
  const [editing, setEditing] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/quotes/boxes?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !j.boxes_only) return;
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setGrades(Array.isArray(j.grades) ? j.grades : []);
        setLocked(j.locked === true);
        setPerBox(j.per_box === true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  if (!rows || rows.length === 0) return null;

  const startEdit = (r: Row) => {
    setEditing(r.id);
    setDraft(toDraft(r));
    setNote(null);
  };

  const save = async () => {
    if (editing == null || !draft) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no: quoteNo,
          box_id: editing,
          L: Number(draft.L),
          W: Number(draft.W),
          D: boxStyleInfo(draft.style).usesDepth ? Number(draft.D) : 0,
          style: draft.style,
          cells_across: Number(draft.cellsA),
          cells_down: Number(draft.cellsD),
          grade_id: /^\d+$/.test(draft.gradeId) ? Number(draft.gradeId) : null,
          qty: Number(draft.qty),
          colors: draft.colors,
          sides: draft.sides,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setNote(j?.message || `Couldn't save the box (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const digits = (v: string) => v.replace(/[^\d]/g, "");
  const decimal = (v: string) => v.replace(/[^\d.]/g, "");
  const editRow = rows.find((r) => r.id === editing) || null;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--surface-card)",
        padding: 16,
        marginBottom: 20,
      }}
      data-box-edit-panel
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Boxes on this quote</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        {locked
          ? "Released quote: use Revise to change the boxes."
          : "Change a box's size, style, board grade, printing or quantity. Saving reprices that box at today's rates."}
        {!locked && !perBox ? " Printing applies to the whole quote." : ""}
      </div>

      {rows.map((r, i) => (
        <div
          key={r.id}
          style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)", paddingTop: i === 0 ? 0 : 10, marginTop: i === 0 ? 0 : 10 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div style={{ fontSize: 12, color: "var(--text-primary)" }}>
              <div style={{ fontWeight: 500 }}>
                {(r.style as string) === "assembly" ? (
                  <>Assembly and packing · {r.qty.toLocaleString("en-US")} display{r.qty === 1 ? "" : "s"}</>
                ) : (
                <>
                {rows.length > 1 ? `Size ${i + 1}: ` : ""}
                {r.L ?? "?"} × {r.W ?? "?"}
                {boxStyleInfo(boxStyleOrRsc(r.style)).usesDepth ? ` × ${r.D ?? "?"}` : ""} in {boxStyleInfo(boxStyleOrRsc(r.style)).label}
                {r.cells_across && r.cells_down ? `, ${r.cells_across} × ${r.cells_down} cells` : ""}
                {r.kind === "stock" && r.sku ? ` (stock ${r.sku})` : ""} · qty {r.qty.toLocaleString("en-US")}
                </>
                )}
              </div>
              {r.description ? <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{r.description}</div> : null}
            </div>
            {/* Step 39D: assembly and packing is changed on the Display card */}
            {(r.style as string) === "assembly" ? (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Set on the Display card</span>
            ) : !locked && editing !== r.id ? (
              <button type="button" style={btn} onClick={() => startEdit(r)} data-edit-box={r.id}>
                {r.style === "dieline" ? "Edit qty / grade / print" : "Edit box"}
              </button>
            ) : null}
          </div>

          {editing === r.id && draft && editRow ? (
            <div style={{ marginTop: 10 }} data-box-editor={r.id}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                {/* Step 39C: a die line box keeps its file's size (Edit lines re-reads the file) */}
                {(["L", "W", "D"] as const)
                  .filter((k) => draft.style !== "dieline" && (k !== "D" || boxStyleInfo(draft.style).usesDepth))
                  .map((k) => (
                  <label key={k}>
                    <div style={label}>
                      {k === "L" ? "Length (in)" : k === "W" ? "Width (in)" : `${boxStyleInfo(draft.style).depthLabel} (in)`}
                    </div>
                    <input
                      style={input}
                      inputMode="decimal"
                      aria-label={k === "L" ? "Inside length" : k === "W" ? "Inside width" : "Inside depth"}
                      value={draft[k]}
                      onChange={(e) => set({ [k]: decimal(e.target.value) } as Partial<Draft>)}
                    />
                  </label>
                ))}
                <label>
                  <div style={label}>Quantity</div>
                  <input
                    style={input}
                    inputMode="numeric"
                    aria-label="Quantity"
                    value={draft.qty}
                    onChange={(e) => set({ qty: digits(e.target.value) })}
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                {draft.style === "dieline" ? (
                  <div style={{ ...label, gridColumn: "span 2", alignSelf: "end" }} data-dieline-size>
                    Size and rule from the die line file ({draft.L} × {draft.W} in blank). Use Edit lines below to
                    change how the file is read.
                  </div>
                ) : (
                <label>
                  <div style={label}>Style</div>
                  <select
                    style={input}
                    aria-label="Style"
                    value={draft.style}
                    onChange={(e) => set({ style: boxStyleOrRsc(e.target.value) })}
                  >
                    {BOX_STYLES.map((st) => (
                      <option key={st.key} value={st.key}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </label>
                )}
                {boxStyleInfo(draft.style).cells ? (
                  <>
                    <label>
                      <div style={label}>Cells across</div>
                      <input style={input} inputMode="numeric" aria-label="Cells across" value={draft.cellsA} onChange={(e) => set({ cellsA: digits(e.target.value) })} />
                    </label>
                    <label>
                      <div style={label}>Cells down</div>
                      <input style={input} inputMode="numeric" aria-label="Cells down" value={draft.cellsD} onChange={(e) => set({ cellsD: digits(e.target.value) })} />
                    </label>
                  </>
                ) : null}
                {grades.length > 0 ? (
                  <label>
                    <div style={label}>Board grade</div>
                    <select
                      style={input}
                      aria-label="Board grade"
                      value={draft.gradeId}
                      onChange={(e) => set({ gradeId: e.target.value })}
                    >
                      <option value="">Shop default</option>
                      {grades.map((g) => (
                        <option key={g.id} value={String(g.id)}>
                          {g.name}
                          {g.is_default ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  <div style={label}>Printing</div>
                  <select
                    style={input}
                    aria-label="Print colors"
                    value={String(draft.colors.length)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      set({ colors: Array.from({ length: n }, (_, j) => draft.colors[j] ?? "spot") });
                    }}
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={String(n)}>
                        {n === 0 ? "No print" : `${n} color${n > 1 ? "s" : ""}`}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.colors.length > 0 ? (
                  <label>
                    <div style={label}>Printed on</div>
                    <select
                      style={input}
                      aria-label="Print sides"
                      value={String(draft.sides)}
                      onChange={(e) => set({ sides: e.target.value === "2" ? 2 : 1 })}
                    >
                      <option value="1">Outside</option>
                      <option value="2">Outside + inside</option>
                    </select>
                  </label>
                ) : null}
              </div>

              {draft.colors.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                  {draft.colors.map((c, j) => (
                    <label key={j}>
                      <div style={label}>Color {j + 1}</div>
                      <select
                        style={input}
                        aria-label={`Color ${j + 1} coverage`}
                        value={c}
                        onChange={(e) => {
                          const v: Coverage = e.target.value === "flood" ? "flood" : "spot";
                          set({ colors: draft.colors.map((x, k) => (k === j ? v : x)) });
                        }}
                      >
                        <option value="spot">Spot</option>
                        <option value="flood">Flood</option>
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}

              {editRow.kind === "stock" ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  Stock box: changing the size or style makes it a custom box priced from your corrugated rates.
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button type="button" style={btn} disabled={busy} onClick={save} data-save-box>
                  {busy ? "Saving…" : "Save and reprice"}
                </button>
                <button
                  type="button"
                  style={btn}
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setDraft(null);
                    setNote(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {note ? <div style={{ marginTop: 8, fontSize: 12, color: "var(--attention)" }}>{note}</div> : null}
    </div>
  );
}
