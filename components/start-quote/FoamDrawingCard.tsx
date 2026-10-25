// components/start-quote/FoamDrawingCard.tsx
//
// Step 40: "Have a drawing?" on the foam steps of the buyer Start Quote form
// (StartQuoteModal) and the staff Start a quote form (RepStartQuoteModal).
// The buyer picks a DXF or a vector PDF; /api/quote/foam-drawing-preview
// reads it (nothing saved) and the card shows the outline size, pockets and
// a small drawing. When the form opens the layout editor it first sends the
// file to the quote (uploadFoamDrawing -> /api/sketch-upload, drawing=1), and
// the editor opens with it (URL drawing=1 keeps the form's thicknesses).

"use client";

import * as React from "react";

export type FoamDrawingSummary = {
  length_in: number;
  width_in: number;
  cavities: number;
  inserts: number;
  warnings: string[];
  svg: string;
};
export type FoamDrawing = { file: File; summary: FoamDrawingSummary } | null;

/** Read a drawing for the card (nothing is saved). */
export async function readFoamDrawing(f: File): Promise<{ ok: true; summary: FoamDrawingSummary } | { ok: false; message: string }> {
  if (!/\.(dxf|pdf)$/i.test(f.name)) return { ok: false, message: "Use a .dxf file or a vector .pdf from your CAD program." };
  if (f.size > 15 * 1024 * 1024) return { ok: false, message: "That file is over 15 MB." };
  try {
    const fd = new FormData();
    fd.set("file", f);
    const res = await fetch("/api/quote/foam-drawing-preview", { method: "POST", body: fd });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) return { ok: false, message: j?.message || "We couldn't read that drawing." };
    return {
      ok: true,
      summary: {
        length_in: Number(j.length_in) || 0,
        width_in: Number(j.width_in) || 0,
        cavities: Number(j.cavities) || 0,
        inserts: Number(j.inserts) || 1,
        warnings: Array.isArray(j.warnings) ? j.warnings : [],
        svg: typeof j.svg === "string" ? j.svg : "",
      },
    };
  } catch {
    return { ok: false, message: "We couldn't read that drawing." };
  }
}

/** Send the drawing to the quote before the editor opens (makes the draft quote when needed). */
export async function uploadFoamDrawing(
  d: NonNullable<FoamDrawing>,
  args: { quoteNo: string; tenantSlug?: string | null; quoteSource?: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const fd = new FormData();
    fd.set("file", d.file);
    fd.set("filename", d.file.name);
    fd.set("quote_no", args.quoteNo);
    fd.set("drawing", "1");
    if (args.tenantSlug) fd.set("tenant_slug", args.tenantSlug);
    if (args.quoteSource) fd.set("quote_source", args.quoteSource);
    const res = await fetch(`/api/sketch-upload?quote_no=${encodeURIComponent(args.quoteNo)}`, { method: "POST", body: fd });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) {
      const msg = j?.message || (typeof j?.detail === "string" ? j.detail : null) || "We couldn't attach your drawing.";
      return { ok: false, message: msg };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "We couldn't attach your drawing." };
  }
}

export default function FoamDrawingCard({
  value,
  onChange,
  note,
  dataPrefix,
}: {
  value: FoamDrawing;
  onChange: (v: FoamDrawing) => void;
  note?: string; // what the drawing sets on this form (e.g. "It sets the insert's length and width.")
  dataPrefix: string; // "foam-drawing" (buyer) or "rep-foam-drawing" (staff)
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [inputKey, setInputKey] = React.useState(0);

  const pick = async (f: File | null) => {
    setError(null);
    if (!f) {
      onChange(null);
      setInputKey((k) => k + 1);
      return;
    }
    setBusy(true);
    try {
      const r = await readFoamDrawing(f);
      if (!r.ok) {
        setError(r.message);
        onChange(null);
        setInputKey((k) => k + 1);
        return;
      }
      onChange({ file: f, summary: r.summary });
    } finally {
      setBusy(false);
    }
  };

  const s = value?.summary;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" {...{ [`data-${dataPrefix}`]: "" }}>
      <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">HAVE A DRAWING? (OPTIONAL)</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">
        Upload the part as a DXF, or a PDF saved from your CAD program. The layout editor opens with its outline and
        pockets, and you can adjust everything there. {note || ""}
      </div>
      {!value ? (
        <input
          key={inputKey}
          type="file"
          accept=".dxf,.pdf"
          aria-label="Foam drawing file"
          onChange={(e) => void pick(e.target.files?.[0] || null)}
          className="mt-3 block w-full text-sm text-[var(--text-secondary)]"
          {...{ [`data-${dataPrefix}-input`]: "" }}
        />
      ) : null}
      {busy ? <div className="mt-2 text-xs text-[var(--text-muted)]">Reading…</div> : null}
      {error ? (
        <div className="mt-2 text-sm text-[var(--attention)]" {...{ [`data-${dataPrefix}-error`]: "" }}>
          {error}
        </div>
      ) : null}
      {value && s ? (
        <div className="mt-3 flex flex-wrap items-start gap-3" {...{ [`data-${dataPrefix}-read`]: "" }}>
          {s.svg ? (
            <div
              className="h-24 w-24 shrink-0 rounded-md border border-[var(--border)] bg-white p-1"
              aria-label="Drawing preview"
              dangerouslySetInnerHTML={{ __html: s.svg }}
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-1 text-sm text-[var(--text-secondary)]">
            <div className="truncate font-medium text-[var(--text-primary)]">{value.file.name}</div>
            <div>
              Outline{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {s.length_in} × {s.width_in} in
              </span>
              , {s.cavities} pocket{s.cavities === 1 ? "" : "s"}.
            </div>
            {s.inserts > 1 ? (
              <div className="text-xs text-[var(--text-muted)]">
                This drawing has {s.inserts} separate parts. The editor opens one and offers to add the others.
              </div>
            ) : null}
            {s.warnings.length ? (
              <ul className="list-disc pl-5 text-xs text-[var(--text-muted)]">
                {s.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => void pick(null)}
              className="text-xs text-[var(--text-secondary)] underline"
              {...{ [`data-${dataPrefix}-remove`]: "" }}
            >
              Remove the drawing
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
