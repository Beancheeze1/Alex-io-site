// components/start-quote/DielineUploadCard.tsx
//
// Step 39H: "Price from a die line file" for the staff Start a quote form
// (RepStartQuoteModal, Boxes only). A DXF is read here in the browser
// (lib/dieline-import.ts); a PDF through /api/quote/dieline-preview. Shows
// what was read: one part (blank + rule), or a display's parts with a name
// and how many go in one display. The quote itself is made by
// /api/quote/boxes-only (multipart), which reads the file again.

"use client";

import * as React from "react";
import { analyzeDieline, BUYER_DIELINE_MAX_PARTS, splitDieline } from "@/lib/dieline-import";

export type DielineRead = {
  units_label: string;
  warnings: string[];
  length_in: number;
  width_in: number;
  rule_in: number;
  pieces: { piece: number; length_in: number; width_in: number; rule_in: number }[];
};
export type DielineUpload = {
  file: File;
  read: DielineRead;
  parts: Record<number, { label: string; per: string }>;
} | null;

/** The parts to send with the quote (empty for a one-part file). */
export function dielinePartsPayload(d: DielineUpload): { piece: number; label: string | null; per_display: number }[] {
  if (!d || d.read.pieces.length < 2) return [];
  return Object.entries(d.parts).map(([piece, v]) => ({
    piece: Number(piece),
    label: v.label.trim() || null,
    per_display: Number(v.per) || 1,
  }));
}
/** Every part has a whole-number count of 1 or more. */
export function dielinePartsOk(d: DielineUpload): boolean {
  return !d || d.read.pieces.length < 2 || Object.values(d.parts).every((p) => /^\d+$/.test(p.per) && Number(p.per) >= 1);
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

  const pick = async (f: File | null) => {
    setError(null);
    onChange(null);
    if (!f) {
      setInputKey((k) => k + 1);
      return;
    }
    if (!/\.(dxf|pdf)$/i.test(f.name)) {
      setError("Use a .dxf file or a vector .pdf die line.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("That file is over 5 MB.");
      return;
    }
    setBusy(true);
    try {
      let read: DielineRead;
      if (/\.pdf$/i.test(f.name)) {
        const fd = new FormData();
        fd.set("file", f);
        const res = await fetch("/api/quote/dieline-preview", { method: "POST", body: fd });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          setError(j?.message || "We couldn't read that PDF.");
          return;
        }
        const pieces: DielineRead["pieces"] = Array.isArray(j.pieces) ? j.pieces : [];
        read = {
          units_label: String(j.units_label || ""),
          warnings: Array.isArray(j.warnings) ? j.warnings : [],
          length_in: Number(j.measure?.length_in) || 0,
          width_in: Number(j.measure?.width_in) || 0,
          rule_in: Number(j.measure?.rule_in) || 0,
          pieces: pieces.length > 1 ? pieces : [],
        };
      } else {
        const text = await f.text();
        const a = analyzeDieline(text, { split: true });
        if (!a.ok) {
          setError(a.message);
          return;
        }
        let pieces: DielineRead["pieces"] = [];
        if (a.measure.pieces > 1) {
          const sp = splitDieline(text);
          if (!sp.ok) {
            setError(sp.message);
            return;
          }
          if (sp.pieces.length > BUYER_DIELINE_MAX_PARTS) {
            setError(`That file has ${sp.pieces.length} separate parts; up to ${BUYER_DIELINE_MAX_PARTS} here. Add the rest on the quote page.`);
            return;
          }
          pieces = sp.pieces.map((p) => ({ piece: p.piece, length_in: p.length_in, width_in: p.width_in, rule_in: p.rule_in }));
        }
        read = {
          units_label: a.units_label,
          warnings: a.warnings,
          length_in: a.measure.length_in,
          width_in: a.measure.width_in,
          rule_in: a.measure.rule_in,
          pieces,
        };
      }
      onChange({
        file: f,
        read,
        parts: read.pieces.length > 1 ? Object.fromEntries(read.pieces.map((p) => [p.piece, { label: "", per: "1" }])) : {},
      });
    } catch {
      setError("We couldn't read that file.");
    } finally {
      setBusy(false);
    }
  };

  const setPart = (piece: number, patch: Partial<{ label: string; per: string }>) => {
    if (!value) return;
    onChange({ ...value, parts: { ...value.parts, [piece]: { ...(value.parts[piece] ?? { label: "", per: "1" }), ...patch } } });
  };
  const multi = !!value && value.read.pieces.length > 1;

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-rep-dieline>
      <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">PRICE FROM A DIE LINE FILE (OPTIONAL)</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">
        The customer&apos;s DXF, or a vector PDF from their CAD program: a box, a display or any die-cut part. A file with
        several separate parts is quoted as a display, and the quantity is the number of displays. You can check how the
        lines were read on the quote page.
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
          ) : (
            <div>
              One part:{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {value.read.length_in} × {value.read.width_in} in blank
              </span>
              , {Math.round(value.read.rule_in)} in of rule.
            </div>
          )}
          {value.read.warnings.length ? (
            <ul className="list-disc pl-5 text-xs text-[var(--text-muted)]">
              {value.read.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="text-xs text-[var(--text-muted)]">Units: {value.read.units_label}.</div>
          <button type="button" onClick={() => void pick(null)} className="text-xs text-[var(--text-secondary)] underline" data-rep-dieline-remove>
            Remove the file and enter a box instead
          </button>
        </div>
      ) : null}
    </div>
  );
}
