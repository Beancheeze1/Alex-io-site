// components/admin/DielineImportCard.tsx
//
// Step 39C: "Price from a die line" on the admin quote page (boxes-only
// quotes). Staff upload a DXF die line for one of the quote's boxes, check
// how each group of lines was read (cut / crease / perf / ignore, with the
// reason), the units, the blank and rule inches and a price preview, then
// apply it: the box is priced from the file (board from the blank, nested
// by sheet when the shop buys sheets; the die and the CAD table time from
// the rule). A box already priced from a file can be re-read (Edit lines).
// Backed by /api/admin/quotes/dieline. Renders nothing on other quotes.

"use client";

import * as React from "react";

type Role = "cut" | "crease" | "perf" | "ignore";
type Group = {
  key: string;
  layer: string;
  ltype: string;
  dashed: boolean;
  color: number;
  segments: number;
  length_in: number;
  role: Role;
  auto_role: Role;
  reason: string;
};
type Analysis = {
  ok: true;
  units: "in" | "mm";
  units_label: string;
  groups: Group[];
  measure: {
    length_in: number;
    width_in: number;
    sqft: number;
    cut_in: number;
    crease_in: number;
    perf_in: number;
    rule_in: number;
    pieces: number;
  };
  warnings: string[];
};
type Price = {
  qty: number;
  unit: number | null;
  extended: number | null;
  tooling: number | null;
  plates: number | null;
  method: string | null;
  description: string;
  note: string | null;
};
type Stored = { attachment_id?: number | null; filename?: string | null; roles?: Record<string, Role>; units?: "in" | "mm" } | null;
type Row = { id: number; description: string | null; style: string | null; qty: number; dieline: Stored };

const ROLE_LABEL: Record<Role, string> = { cut: "Cut", crease: "Crease", perf: "Perf", ignore: "Ignore" };
const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

const card: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--surface-card)",
  padding: 16,
  marginBottom: 20,
};
const btn: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
};
const primary: React.CSSProperties = { ...btn, background: "var(--action-primary)", borderColor: "var(--action-primary)", color: "#fff" };
const small: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
const select: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "2px 6px",
  fontSize: 12,
};

export default function DielineImportCard({ quoteNo }: { quoteNo: string }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [show, setShow] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [boxId, setBoxId] = React.useState<number | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [attachmentId, setAttachmentId] = React.useState<number | null>(null);
  const [roles, setRoles] = React.useState<Record<string, Role>>({});
  const [units, setUnits] = React.useState<"auto" | "in" | "mm">("auto");
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [price, setPrice] = React.useState<Price | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/quotes/dieline?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !j.boxes_only) return;
        setRows(j.rows || []);
        setLocked(!!j.locked);
        setShow(true);
        if (j.rows?.length) setBoxId(Number(j.rows[0].id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  const send = React.useCallback(
    async (mode: "preview" | "apply", over?: { roles?: Record<string, Role>; units?: "auto" | "in" | "mm" }) => {
      if (boxId == null || (!file && !attachmentId)) return;
      setBusy(true);
      setNote(null);
      try {
        const fd = new FormData();
        fd.set("quote_no", quoteNo);
        fd.set("box_id", String(boxId));
        fd.set("mode", mode);
        if (file) fd.set("file", file);
        else if (attachmentId) fd.set("attachment_id", String(attachmentId));
        fd.set("roles", JSON.stringify(over?.roles ?? roles));
        fd.set("units", over?.units ?? units);
        const res = await fetch("/api/admin/quotes/dieline", { method: "POST", body: fd });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          setNote(j?.message || `Couldn't read the die line (HTTP ${res.status}).`);
          if (mode === "preview") {
            setAnalysis(null);
            setPrice(null);
          }
          return;
        }
        if (mode === "apply") {
          window.location.reload();
          return;
        }
        setAnalysis(j.analysis);
        setPrice(j.price);
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [boxId, file, attachmentId, quoteNo, roles, units],
  );

  // Re-read whenever the file or the box changes.
  React.useEffect(() => {
    if (file || attachmentId) void send("preview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, attachmentId, boxId]);

  if (!show || rows.length === 0) return null;

  const setRole = (key: string, role: Role) => {
    const next = { ...roles, [key]: role };
    setRoles(next);
    void send("preview", { roles: next });
  };
  const setUnitsAnd = (u: "auto" | "in" | "mm") => {
    setUnits(u);
    void send("preview", { units: u });
  };
  const editStored = (r: Row) => {
    setBoxId(r.id);
    setFile(null);
    setRoles((r.dieline?.roles as Record<string, Role>) || {});
    setUnits(r.dieline?.units || "auto");
    setAttachmentId(r.dieline?.attachment_id ?? null);
    if (!r.dieline?.attachment_id) setNote("This box's die line file isn't on the quote any more. Upload it again.");
  };
  const m = analysis?.measure;

  return (
    <div style={card} data-dieline-card>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Price from a die line</div>
      <div style={{ ...small, marginBottom: 10 }}>
        Upload the buyer&apos;s die line (DXF) for a box. Cut, crease and perforation lines are read from the layer names,
        dashed lines and red lines; check them below. The box is priced as a die-cut box: board from the blank (nested on
        your sheets when you buy sheets), the cutting die from the rule inches on press runs, and CAD table time from the
        same inches on short runs.
      </div>

      {rows.some((r) => r.style === "dieline") ? (
        <div style={{ marginBottom: 10 }} data-dieline-stored>
          {rows
            .filter((r) => r.style === "dieline")
            .map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "var(--text-primary)" }}>{r.dieline?.filename || "Die line"}</span>
                <span style={small}>{r.description}</span>
                {!locked ? (
                  <button type="button" style={btn} onClick={() => editStored(r)} data-dieline-edit={r.id}>
                    Edit lines
                  </button>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      {locked ? (
        <div style={small}>Released quote: use Revise to change the boxes.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {rows.length > 1 ? (
            <label style={small}>
              Box{" "}
              <select style={select} value={boxId ?? ""} onChange={(e) => setBoxId(Number(e.target.value))} aria-label="Box">
                {rows.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    Size {i + 1}: {(r.description || "").slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <input
            type="file"
            accept=".dxf"
            aria-label="Die line file"
            data-dieline-file
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setAttachmentId(null);
              setRoles({});
              setUnits("auto");
              setFile(f);
            }}
            style={{ fontSize: 12 }}
          />
          {busy ? <span style={small}>Reading…</span> : null}
        </div>
      )}

      {note ? <div style={{ marginTop: 8, fontSize: 12, color: "var(--attention)" }}>{note}</div> : null}

      {analysis && m && !locked ? (
        <div style={{ marginTop: 12 }} data-dieline-result>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: "var(--text-primary)" }}>
            <div data-dieline-blank>
              <div style={small}>Blank</div>
              {m.length_in.toFixed(3)} × {m.width_in.toFixed(3)} in · {m.sqft.toFixed(3)} sq ft
            </div>
            <div data-dieline-rule>
              <div style={small}>Rule</div>
              {m.rule_in.toFixed(1)} in (cut {m.cut_in.toFixed(1)} · crease {m.crease_in.toFixed(1)}
              {m.perf_in > 0 ? ` · perf ${m.perf_in.toFixed(1)}` : ""})
            </div>
            <div>
              <div style={small}>Units</div>
              <select style={select} value={units} onChange={(e) => setUnitsAnd(e.target.value as "auto" | "in" | "mm")} aria-label="Units">
                <option value="auto">From the file ({analysis.units_label})</option>
                <option value="in">Inches</option>
                <option value="mm">Millimeters</option>
              </select>
            </div>
          </div>

          <table style={{ marginTop: 10, width: "100%", fontSize: 12, borderCollapse: "collapse" }} data-dieline-groups>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                <th style={{ padding: "4px 6px" }}>Layer</th>
                <th style={{ padding: "4px 6px" }}>Line</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Inches</th>
                <th style={{ padding: "4px 6px" }}>Read as</th>
                <th style={{ padding: "4px 6px" }}>Why</th>
              </tr>
            </thead>
            <tbody>
              {analysis.groups.map((g) => (
                <tr key={g.key} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px", color: "var(--text-primary)" }}>{g.layer}</td>
                  <td style={{ padding: "4px 6px", color: "var(--text-secondary)" }}>
                    {g.dashed ? "dashed" : "solid"}
                    {g.color === 1 ? ", red" : ""}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{g.length_in.toFixed(1)}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <select
                      style={select}
                      value={g.role}
                      onChange={(e) => setRole(g.key, e.target.value as Role)}
                      aria-label={`Read ${g.layer} as`}
                      data-dieline-role={g.key}
                    >
                      {(["cut", "crease", "perf", "ignore"] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "4px 6px", color: "var(--text-muted)" }}>
                    {g.role === g.auto_role ? g.reason : "changed by you"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {analysis.warnings.length ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--attention)" }} data-dieline-warnings>
              {analysis.warnings.join(" ")}
            </div>
          ) : null}

          {price ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-primary)" }} data-dieline-price>
              At qty {price.qty.toLocaleString("en-US")}: {usd(price.unit)} per box, {usd(price.extended)} for the boxes
              {price.tooling ? ` + ${usd(price.tooling)} cutting die (one time)` : ""}
              {price.plates ? ` + ${usd(price.plates)} plates` : ""}
              {price.method === "digital" ? " · short run (CAD cut, no die)" : ""}.
              {price.note ? <div style={{ ...small, marginTop: 2 }}>{price.note}</div> : null}
            </div>
          ) : null}

          <div style={{ marginTop: 10 }}>
            <button type="button" style={primary} disabled={busy} onClick={() => void send("apply")} data-dieline-apply>
              Price this box from the file
            </button>
            <span style={{ ...small, marginLeft: 8 }}>Replaces this box&apos;s size and style; quantity, grade and printing stay.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
