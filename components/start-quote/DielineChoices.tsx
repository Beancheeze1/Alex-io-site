// components/start-quote/DielineChoices.tsx
//
// Step 39P: shared by the buyer Start Quote form (StartQuoteModal) and the
// staff Start a quote form (DielineUploadCard):
//   readDielineFile(file, { units, roles }) -> what was read (a DXF in the
//     browser, a PDF through /api/quote/dieline-preview); nothing is saved.
//   <DielineChoices> -> the "Units" pick (inches unless mm is picked; off when
//     the file says its own units) and "What is this file?" (One part / A
//     display), with the reason when a display can't be split.
// The quote itself is made by /api/quote/boxes-only, which reads the file
// again with the same choices (dieline_units, dieline_as, dieline_roles).

"use client";

import * as React from "react";
import {
  analyzeDieline,
  BUYER_DIELINE_MAX_PARTS,
  DIELINE_NOT_DISPLAY,
  dielineLinesSvg,
  splitDieline,
  type DielineRole,
} from "@/lib/dieline-import";

export type DielineLineGroup = {
  key: string;
  layer: string;
  color: number;
  dashed: boolean;
  length_in: number;
  role: DielineRole;
  auto_role: DielineRole;
  reason: string;
};
export type DielineRead = {
  units_label: string;
  units_set: boolean;
  warnings: string[];
  length_in: number;
  width_in: number;
  rule_in: number;
  // Step 39W: svg = a small drawing of the part (its own lines)
  pieces: { piece: number; length_in: number; width_in: number; rule_in: number; svg?: string }[];
  groups: DielineLineGroup[];
};
export type DielineUnitsPick = "in" | "mm";
export type DielineAsPick = "single" | "display";

/** Read a die line file the way the quote will (units pick, staff's line roles). */
export async function readDielineFile(
  f: File,
  opts: { units: DielineUnitsPick; roles?: Record<string, DielineRole> | null },
): Promise<{ ok: true; read: DielineRead } | { ok: false; message: string }> {
  if (!/\.(dxf|pdf)$/i.test(f.name)) return { ok: false, message: "Use a .dxf file or a vector .pdf die line." };
  if (f.size > 5 * 1024 * 1024) return { ok: false, message: "That file is over 5 MB." };
  const roles = opts.roles && Object.keys(opts.roles).length ? opts.roles : null;
  // Inches is the default: read as "the file's units, else inches" so the label says which.
  const units = opts.units === "mm" ? "mm" : "auto";
  try {
    if (/\.pdf$/i.test(f.name)) {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("units", units);
      if (roles) fd.set("roles", JSON.stringify(roles));
      const res = await fetch("/api/quote/dieline-preview", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) return { ok: false, message: j?.message || "We couldn't read that PDF." };
      const pieces: DielineRead["pieces"] = Array.isArray(j.pieces) ? j.pieces : [];
      return {
        ok: true,
        read: {
          units_label: String(j.units_label || ""),
          units_set: j.units_set !== false,
          warnings: Array.isArray(j.warnings) ? j.warnings : [],
          length_in: Number(j.measure?.length_in) || 0,
          width_in: Number(j.measure?.width_in) || 0,
          rule_in: Number(j.measure?.rule_in) || 0,
          pieces: pieces.length > 1 ? pieces : [],
          groups: Array.isArray(j.groups) ? j.groups : [],
        },
      };
    }
    const text = await f.text();
    const a = analyzeDieline(text, { split: true, units, roles });
    if (!a.ok) return { ok: false, message: a.message };
    let pieces: DielineRead["pieces"] = [];
    if (a.measure.pieces > 1) {
      const sp = splitDieline(text, { units, roles, lines: true });
      if (!sp.ok) return { ok: false, message: sp.message };
      if (sp.pieces.length > BUYER_DIELINE_MAX_PARTS) {
        return {
          ok: false,
          message: `That file has ${sp.pieces.length} separate parts. Online quotes take up to ${BUYER_DIELINE_MAX_PARTS}; send it to the shop and they'll quote it.`,
        };
      }
      pieces = sp.pieces.map((p) => ({
        piece: p.piece,
        length_in: p.length_in,
        width_in: p.width_in,
        rule_in: p.rule_in,
        svg: dielineLinesSvg(p.lines ?? []), // Step 39W
      }));
    }
    return {
      ok: true,
      read: {
        units_label: a.units_label,
        units_set: a.units_set,
        warnings: a.warnings,
        length_in: a.measure.length_in,
        width_in: a.measure.width_in,
        rule_in: a.measure.rule_in,
        pieces,
        groups: a.groups.map((g) => ({
          key: g.key,
          layer: g.layer,
          color: g.color,
          dashed: g.dashed,
          length_in: g.length_in,
          role: g.role,
          auto_role: g.auto_role,
          reason: g.reason,
        })),
      },
    };
  } catch {
    return { ok: false, message: "We couldn't read that file." };
  }
}

/**
 * Step 39W: the part's small drawing at the start of its row in the parts
 * table; click it to see it larger (Escape or a click closes it).
 */
export function DielinePartThumb({
  piece,
  name,
  size,
}: {
  piece: { piece: number; length_in: number; width_in: number; svg?: string };
  name: string;
  size?: number;
}) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const box = size ?? 56;
  if (!piece.svg) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-[var(--border)] text-[10px] text-[var(--text-faint)]"
        style={{ width: box, height: box }}
      >
        {piece.piece}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`See ${name} larger`}
        aria-label={`See ${name} larger`}
        className="block rounded-md border border-[var(--border)] bg-white p-1 transition hover:border-[var(--action-primary)]"
        style={{ width: box, height: box }}
        data-dieline-thumb={piece.piece}
        dangerouslySetInnerHTML={{ __html: piece.svg }}
      />
      {open ? (
        <div
          role="dialog"
          aria-label={`${name} drawing`}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          data-dieline-thumb-big
        >
          <div className="w-full max-w-lg rounded-xl bg-[var(--surface-card)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {name} <span className="font-normal text-[var(--text-muted)]">· {piece.length_in} × {piece.width_in} in blank</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--text-secondary)] underline">
                Close
              </button>
            </div>
            <div className="h-80 w-full rounded-md border border-[var(--border)] bg-white p-2" dangerouslySetInnerHTML={{ __html: piece.svg }} />
            <div className="mt-2 text-[11px] text-[var(--text-muted)]">Solid: cut · Dashed blue: crease · Dotted: perf</div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A display was picked but the file has one outline: nothing to split. */
export function dielineDisplayBlocked(read: DielineRead | null, as: DielineAsPick): boolean {
  return !!read && as === "display" && read.pieces.length < 2;
}

/** The notes to show: with "One part" picked, not the per-part pricing note. */
export function dielineWarnings(read: DielineRead, as: DielineAsPick): string[] {
  return as === "single" ? read.warnings.filter((w) => !/separate pieces/.test(w)) : read.warnings;
}

/** AutoCAD color index -> a name for the line table. */
export function aciName(c: number): string {
  const names: Record<number, string> = { 1: "Red", 2: "Yellow", 3: "Green", 4: "Cyan", 5: "Blue", 6: "Magenta", 7: "Black / white", 8: "Gray", 9: "Light gray" };
  return names[c] ?? `Color ${c}`;
}
export function aciSwatch(c: number): string {
  const hex: Record<number, string> = { 1: "#e11d48", 2: "#eab308", 3: "#16a34a", 4: "#06b6d4", 5: "#2563eb", 6: "#c026d3", 7: "#111827", 8: "#6b7280", 9: "#9ca3af" };
  return hex[c] ?? "#94a3b8";
}

export default function DielineChoices({
  read,
  units,
  as,
  onUnits,
  onAs,
  dataPrefix,
}: {
  read: DielineRead;
  units: DielineUnitsPick;
  as: DielineAsPick;
  onUnits: (u: DielineUnitsPick) => void;
  onAs: (a: DielineAsPick) => void;
  dataPrefix: string; // "dieline" (buyer) or "rep-dieline" (staff), for the data- hooks
}) {
  const radio = "mr-1.5 align-middle";
  const multi = read.pieces.length > 1;
  return (
    <div className="space-y-2" {...{ [`data-${dataPrefix}-choices`]: "" }}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="text-xs text-[var(--text-secondary)]">
          Units{" "}
          <select
            aria-label="Die line units"
            value={read.units_set ? "file" : units}
            disabled={read.units_set}
            onChange={(e) => onUnits(e.target.value === "mm" ? "mm" : "in")}
            className="ml-1 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-primary)] disabled:opacity-70"
            {...{ [`data-${dataPrefix}-units`]: "" }}
          >
            {read.units_set ? <option value="file">From the file</option> : null}
            <option value="in">Inches</option>
            <option value="mm">Millimeters</option>
          </select>
        </label>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" {...{ [`data-${dataPrefix}-as`]: "" }}>
          <legend className="sr-only">What is this file?</legend>
          <span className="text-[var(--text-muted)]">This file is</span>
          <label>
            <input type="radio" className={radio} name={`${dataPrefix}-as`} checked={as === "single"} onChange={() => onAs("single")} />
            One part
          </label>
          <label>
            <input type="radio" className={radio} name={`${dataPrefix}-as`} checked={as === "display"} onChange={() => onAs("display")} />
            A display (several parts)
          </label>
        </fieldset>
      </div>
      {dielineDisplayBlocked(read, as) ? (
        <div className="text-xs text-[var(--attention)]" {...{ [`data-${dataPrefix}-not-display`]: "" }}>
          {DIELINE_NOT_DISPLAY}
        </div>
      ) : null}
      {as === "single" && multi ? (
        <div className="text-xs text-[var(--text-muted)]">
          The {read.pieces.length} outlines are priced as one {read.length_in} × {read.width_in} in blank holding all of them.
        </div>
      ) : null}
    </div>
  );
}
