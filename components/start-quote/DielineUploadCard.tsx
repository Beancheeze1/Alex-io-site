// components/start-quote/DielineUploadCard.tsx
//
// Step 39H: "Price from a die line file" for the staff Start a quote form
// (RepStartQuoteModal, Boxes only). A DXF is read here in the browser
// (lib/dieline-import.ts); a PDF through /api/quote/dieline-preview. Shows
// what was read: one part (blank + rule), or a display's parts with a name
// and how many go in one display. The quote itself is made by
// /api/quote/boxes-only (multipart), which reads the file again.
// Step 39P: the Units pick (inches unless mm), "This file is One part / A
// display", and the line table (each color: cut / crease / perf / ignore),
// so a file is set up here instead of on the quote page.

"use client";

import * as React from "react";
import { DIELINE_ROLES, type DielineRole } from "@/lib/dieline-import";
import DielineChoices, {
  aciName,
  aciSwatch,
  dielineDisplayBlocked,
  dielineWarnings,
  readDielineFile,
  type DielineAsPick,
  type DielineRead,
  type DielineUnitsPick,
} from "@/components/start-quote/DielineChoices";

export type { DielineRead };
export type DielineUpload = {
  file: File;
  read: DielineRead;
  parts: Record<number, { label: string; per: string }>;
  units: DielineUnitsPick; // Step 39P
  as: DielineAsPick; // Step 39P
  roles: Record<string, DielineRole>; // Step 39P: only the lines staff changed
} | null;

/** True when the file is quoted as a display (picked, and it has 2+ parts). */
export function dielineIsDisplay(d: DielineUpload): boolean {
  return !!d && d.as === "display" && d.read.pieces.length > 1;
}

/** Step 39P: the die line choices for the quote payload. */
export function dielineChoicesPayload(d: DielineUpload): {
  dieline_units: DielineUnitsPick;
  dieline_as: DielineAsPick;
  dieline_roles: Record<string, DielineRole>;
} | null {
  return d ? { dieline_units: d.units, dieline_as: d.as, dieline_roles: d.roles } : null;
}

/** The parts to send with the quote (empty for a one-part file). */
export function dielinePartsPayload(d: DielineUpload): { piece: number; label: string | null; per_display: number }[] {
  if (!d || !dielineIsDisplay(d)) return [];
  return Object.entries(d.parts).map(([piece, v]) => ({
    piece: Number(piece),
    label: v.label.trim() || null,
    per_display: Number(v.per) || 1,
  }));
}
/** Every part has a whole-number count of 1 or more. */
export function dielinePartsOk(d: DielineUpload): boolean {
  if (!d) return true;
  if (dielineDisplayBlocked(d.read, d.as)) return false; // Step 39P: Display picked, one outline
  return !dielineIsDisplay(d) || Object.values(d.parts).every((p) => /^\d+$/.test(p.per) && Number(p.per) >= 1);
}

export default function DielineUploadCard({
  value,
  onChange,
}: {
  value: DielineUpload;
  onChange: (v: DielineUpload) => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [inputKey, setInputKey] = React.useState(0);

  // Step 39P: read (or re-read) the file with the units pick and line roles;
  // keeps the part names / counts when the same parts come back.
  const load = async (
    f: File,
    choice: { units: DielineUnitsPick; as?: DielineAsPick; roles: Record<string, DielineRole> },
    prev: DielineUpload,
  ) => {
    setBusy(true);
    try {
      const r = await readDielineFile(f, { units: choice.units, roles: choice.roles });
      if (!r.ok) {
        setError(r.message);
        if (!prev) onChange(null); // a re-read that fails keeps what was there
        return;
      }
      setError(null);
      const read = r.read;
      const as: DielineAsPick = choice.as ?? (read.pieces.length > 1 ? "display" : "single");
      const keep = prev && prev.read.pieces.length === read.pieces.length ? prev.parts : {};
      onChange({
        file: f,
        read,
        units: choice.units,
        as,
        roles: choice.roles,
        parts: read.pieces.length > 1 ? Object.fromEntries(read.pieces.map((p) => [p.piece, keep[p.piece] ?? { label: "", per: "1" }])) : {},
      });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File | null) => {
    setError(null);
    onChange(null);
    if (!f) {
      setInputKey((k) => k + 1);
      return;
    }
    await load(f, { units: "in", roles: {} }, null);
  };

  const setUnits = (u: DielineUnitsPick) => {
    if (value) void load(value.file, { units: u, as: value.as, roles: value.roles }, value);
  };
  const setAs = (as: DielineAsPick) => {
    if (value) onChange({ ...value, as });
  };
  const setRole = (key: string, role: DielineRole, auto: DielineRole) => {
    if (!value) return;
    const roles = { ...value.roles };
    if (role === auto) delete roles[key];
    else roles[key] = role;
    void load(value.file, { units: value.units, roles }, value);
  };

  const setPart = (piece: number, patch: Partial<{ label: string; per: string }>) => {
    if (!value) return;
    onChange({ ...value, parts: { ...value.parts, [piece]: { ...(value.parts[piece] ?? { label: "", per: "1" }), ...patch } } });
  };
  const multi = dielineIsDisplay(value);

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-rep-dieline>
      <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">PRICE FROM A DIE LINE FILE (OPTIONAL)</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">
        The customer&apos;s DXF, or a vector PDF from their CAD program: a box, a display or any die-cut part. A file with
        several separate parts can be quoted as a display (the quantity is the number of displays). Once it&apos;s read, set
        the units, say whether it&apos;s one part or a display, and check the lines.
      </div>
      <input
        key={inputKey}
        type="file"
        accept=".dxf,.pdf"
        aria-label="Die line file"
        data-rep-dieline-input
        onChange={(e) => void pick(e.target.files?.[0] || null)}
        className="mt-3 block w-full text-sm text-[var(--text-secondary)]"
      />
      {busy ? <div className="mt-2 text-xs text-[var(--text-muted)]">Reading…</div> : null}
      {error ? (
        <div className="mt-2 text-sm text-[var(--attention)]" data-rep-dieline-error>
          {error}
        </div>
      ) : null}
      {value ? (
        <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]" data-rep-dieline-read>
          <DielineChoices read={value.read} units={value.units} as={value.as} onUnits={setUnits} onAs={setAs} dataPrefix="rep-dieline" />
          {multi ? (
            <>
              <div>
                <span className="font-medium text-[var(--text-primary)]">{value.read.pieces.length} parts</span>: name them and
                set how many of each go in one display.
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="py-1 pr-2 font-medium">Part</th>
                    <th className="py-1 pr-2 font-medium">Blank</th>
                    <th className="py-1 font-medium">Per display</th>
                  </tr>
                </thead>
                <tbody>
                  {value.read.pieces.map((p) => (
                    <tr key={p.piece} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-2">
                        <input
                          aria-label={`Part ${p.piece} name`}
                          placeholder={`Part ${p.piece}`}
                          value={value.parts[p.piece]?.label ?? ""}
                          onChange={(e) => setPart(p.piece, { label: e.target.value.slice(0, 60) })}
                          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-primary)]"
                        />
                      </td>
                      <td className="whitespace-nowrap py-1 pr-2">
                        {p.length_in} × {p.width_in} in
                      </td>
                      <td className="py-1">
                        <input
                          aria-label={`Part ${p.piece} per display`}
                          inputMode="numeric"
                          value={value.parts[p.piece]?.per ?? "1"}
                          onChange={(e) => setPart(p.piece, { per: e.target.value.replace(/[^\d]/g, "").slice(0, 5) })}
                          className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-primary)]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dielinePartsOk(value) ? <div className="text-xs text-[var(--attention)]">Enter at least 1 of each part per display.</div> : null}
              <div className="text-xs text-[var(--text-muted)]">Assembly and packing is added from your shop&apos;s rates.</div>
            </>
          ) : dielineDisplayBlocked(value.read, value.as) ? null : (
            <div>
              One part:{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {value.read.length_in} × {value.read.width_in} in blank
              </span>
              , {Math.round(value.read.rule_in)} in of rule.
            </div>
          )}
          {dielineWarnings(value.read, value.as).length ? (
            <ul className="list-disc pl-5 text-xs text-[var(--text-muted)]">
              {dielineWarnings(value.read, value.as).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="text-xs text-[var(--text-muted)]">Units: {value.read.units_label}.</div>
          {value.read.groups.length ? (
            <div data-rep-dieline-lines>
              <div className="text-xs font-medium text-[var(--text-primary)]">Lines</div>
              <table className="mt-1 w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="py-1 pr-2 font-medium">Color / layer</th>
                    <th className="py-1 pr-2 font-medium">Length</th>
                    <th className="py-1 pr-2 font-medium">Read as</th>
                    <th className="py-1 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {value.read.groups.map((g) => (
                    <tr key={g.key} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-2">
                        <span
                          aria-hidden
                          className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                          style={{ background: aciSwatch(g.color) }}
                        />
                        {aciName(g.color)}
                        {g.dashed ? ", dashed" : ""} <span className="text-[var(--text-muted)]">({g.layer})</span>
                      </td>
                      <td className="whitespace-nowrap py-1 pr-2">{Math.round(g.length_in)} in</td>
                      <td className="py-1 pr-2">
                        <select
                          aria-label={`${aciName(g.color)} ${g.layer} lines`}
                          value={g.role}
                          onChange={(e) => setRole(g.key, e.target.value as DielineRole, g.auto_role)}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-1.5 py-0.5 text-xs text-[var(--text-primary)]"
                        >
                          {DIELINE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r === "cut" ? "Cut" : r === "crease" ? "Crease" : r === "perf" ? "Perf" : "Ignore"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 text-[var(--text-muted)]">{g.role === g.auto_role ? g.reason : "changed by you"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <button type="button" onClick={() => void pick(null)} className="text-xs text-[var(--text-secondary)] underline" data-rep-dieline-remove>
            Remove the file and enter a box instead
          </button>
        </div>
      ) : null}
    </div>
  );
}
