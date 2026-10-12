// components/start-quote/BoxSizesEditor.tsx
//
// Step 9B: "Add another size" for boxes-only quotes (Start Quote + rep form).
// Size 1 stays the form's existing box fields. This editor holds sizes 2..10,
// each with its own inside size, style, board grade, printing, quantity and
// up to 3 compare quantities. With any extra size the form posts all sizes to
// POST /api/quote/boxes-only/multi (extra sizes are always custom sizes).

"use client";

import * as React from "react";

export type BoxGradeOption = { id: number; name: string; flute?: string; ect_label?: string; is_default?: boolean };

export type ExtraBoxSize = {
  key: string;
  L: string;
  W: string;
  D: string;
  style: "rsc" | "mailer";
  gradeId: string; // "" = shop default / recommend one
  colors: ("spot" | "flood")[];
  sides: 1 | 2;
  qty: string;
  breaks: string[]; // always 3 slots
};

let keySeq = 0;

export function newExtraBoxSize(seed?: Partial<Omit<ExtraBoxSize, "key">>): ExtraBoxSize {
  keySeq += 1;
  return {
    key: `size-${Date.now()}-${keySeq}`,
    L: "",
    W: "",
    D: "",
    style: "rsc",
    gradeId: "",
    colors: [],
    sides: 1,
    qty: "",
    breaks: ["", "", ""],
    ...seed,
  };
}

function num(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Problem with one extra size, or null when it is complete. `n` is its size number (2, 3, ...). */
export function extraSizeProblem(s: ExtraBoxSize, n: number): string | null {
  const dims = [num(s.L), num(s.W), num(s.D)];
  if (!dims.every((v) => v != null && v > 0 && v <= 1000)) {
    return `Size ${n}: enter the box inside length, width and depth.`;
  }
  const q = num(s.qty);
  if (q == null || !Number.isInteger(q) || q < 1 || q > 10_000_000) {
    return `Size ${n}: enter a whole-number quantity.`;
  }
  return null;
}

/** First problem across all extra sizes (sizes are numbered from 2), or null. */
export function extraSizesProblem(sizes: ExtraBoxSize[]): string | null {
  for (let i = 0; i < sizes.length; i++) {
    const p = extraSizeProblem(sizes[i], i + 2);
    if (p) return p;
  }
  return null;
}

/** One entry of the `boxes` array for POST /api/quote/boxes-only/multi. */
export function extraSizePayload(s: ExtraBoxSize) {
  return {
    qty: num(s.qty),
    L: num(s.L),
    W: num(s.W),
    D: num(s.D),
    style: s.style,
    grade_id: s.style === "rsc" && /^\d+$/.test(s.gradeId) ? Number(s.gradeId) : null,
    print_spec: { colors: s.colors, sides: s.sides },
    qty_breaks: s.breaks.map((b) => Number(String(b).trim())).filter((n) => Number.isInteger(n) && n > 0),
  };
}

/** One-line summary for review screens. */
export function describeExtraSize(s: ExtraBoxSize, grades: BoxGradeOption[], gradeDefaultLabel: string): string {
  const parts: string[] = [];
  parts.push(`${s.L || "?"} x ${s.W || "?"} x ${s.D || "?"} in ${s.style.toUpperCase()}`);
  if (s.style === "rsc" && grades.length > 0) {
    parts.push(grades.find((g) => String(g.id) === s.gradeId)?.name || gradeDefaultLabel);
  }
  parts.push(
    s.colors.length
      ? `${s.colors.length} color${s.colors.length > 1 ? "s" : ""} (${s.colors.join(", ")}), ${s.sides === 2 ? "two sides" : "one side"}`
      : "No print",
  );
  parts.push(`Qty ${s.qty || "?"}`);
  const more = s.breaks.map((b) => b.trim()).filter(Boolean);
  if (more.length) parts.push(`compare ${more.join(", ")}`);
  return parts.join(" · ");
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]";
const labelCls = "mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]";
const optStyle = { color: "#0f172a", backgroundColor: "#fff" };

type Props = {
  sizes: ExtraBoxSize[];
  onChange: (next: ExtraBoxSize[]) => void;
  grades: BoxGradeOption[];
  /** Label for the empty grade choice ("Not sure — recommend one" / "Shop default"). */
  gradeDefaultLabel: string;
  /** Seed for a new size (copied from size 1: style, grade, printing). */
  seed?: () => Partial<Omit<ExtraBoxSize, "key">>;
  /** Short text describing size 1, shown above the list. */
  size1Summary?: string;
  /** Max extra sizes (the multi route allows 10 sizes in total). */
  maxExtra?: number;
};

export default function BoxSizesEditor({
  sizes,
  onChange,
  grades,
  gradeDefaultLabel,
  seed,
  size1Summary,
  maxExtra = 9,
}: Props) {
  const update = (i: number, patch: Partial<ExtraBoxSize>) =>
    onChange(sizes.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(sizes.filter((_, j) => j !== i));
  const add = () => {
    if (sizes.length >= maxExtra) return;
    onChange([...sizes, newExtraBoxSize(seed ? seed() : undefined)]);
  };
  const digits = (v: string) => v.replace(/[^\d]/g, "");
  const decimal = (v: string) => v.replace(/[^\d.]/g, "");

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-box-sizes-editor>
      <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">MORE BOX SIZES (OPTIONAL)</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">
        Need more than one size on this order? Add each size here and they&apos;ll all be priced on one quote.
        {size1Summary ? (
          <>
            {" "}
            Size 1 is <span className="font-medium text-[var(--text-primary)]">{size1Summary}</span>.
          </>
        ) : null}
      </div>

      {sizes.map((s, i) => {
        const n = i + 2;
        const problem = extraSizeProblem(s, n);
        return (
          <div key={s.key} className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">Size {n}</div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove size ${n}`}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                Remove
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3">
              {(["L", "W", "D"] as const).map((k) => (
                <label key={k} className="block">
                  <div className={labelCls}>{k === "L" ? "LENGTH (IN)" : k === "W" ? "WIDTH (IN)" : "DEPTH (IN)"}</div>
                  <input
                    value={s[k]}
                    inputMode="decimal"
                    aria-label={`Size ${n} ${k === "L" ? "length" : k === "W" ? "width" : "depth"}`}
                    onChange={(e) => update(i, { [k]: decimal(e.target.value) } as Partial<ExtraBoxSize>)}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <div className={labelCls}>STYLE</div>
                <select
                  value={s.style}
                  aria-label={`Size ${n} style`}
                  onChange={(e) => update(i, { style: e.target.value === "mailer" ? "mailer" : "rsc" })}
                  className={inputCls}
                >
                  <option value="rsc" style={optStyle}>RSC / Shipper</option>
                  <option value="mailer" style={optStyle}>Mailer box</option>
                </select>
              </label>
              {s.style === "rsc" && grades.length > 0 ? (
                <label className="block">
                  <div className={labelCls}>BOARD GRADE</div>
                  <select
                    value={s.gradeId}
                    aria-label={`Size ${n} board grade`}
                    onChange={(e) => update(i, { gradeId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="" style={optStyle}>{gradeDefaultLabel}</option>
                    {grades.map((g) => (
                      <option key={g.id} value={String(g.id)} style={optStyle}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <div className={labelCls}>PRINTING</div>
                <select
                  value={String(s.colors.length)}
                  aria-label={`Size ${n} print colors`}
                  onChange={(e) => {
                    const c = Number(e.target.value);
                    update(i, { colors: Array.from({ length: c }, (_, j) => s.colors[j] ?? "spot") });
                  }}
                  className={inputCls}
                >
                  {[0, 1, 2, 3, 4].map((c) => (
                    <option key={c} value={String(c)} style={optStyle}>
                      {c === 0 ? "No print" : `${c} color${c > 1 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              {s.colors.length > 0 ? (
                <label className="block">
                  <div className={labelCls}>SIDES</div>
                  <select
                    value={String(s.sides)}
                    aria-label={`Size ${n} print sides`}
                    onChange={(e) => update(i, { sides: e.target.value === "2" ? 2 : 1 })}
                    className={inputCls}
                  >
                    <option value="1" style={optStyle}>One side</option>
                    <option value="2" style={optStyle}>Two sides</option>
                  </select>
                </label>
              ) : null}
            </div>
            {s.colors.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {s.colors.map((c, j) => (
                  <label key={j} className="block">
                    <div className={labelCls}>COLOR {j + 1}</div>
                    <select
                      value={c}
                      aria-label={`Size ${n} color ${j + 1} coverage`}
                      onChange={(e) => {
                        const v: "spot" | "flood" = e.target.value === "flood" ? "flood" : "spot";
                        update(i, { colors: s.colors.map((x, k) => (k === j ? v : x)) });
                      }}
                      className={inputCls}
                    >
                      <option value="spot" style={optStyle}>Spot</option>
                      <option value="flood" style={optStyle}>Flood</option>
                    </select>
                  </label>
                ))}
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="block">
                <div className={labelCls}>QUANTITY</div>
                <input
                  value={s.qty}
                  inputMode="numeric"
                  aria-label={`Size ${n} quantity`}
                  onChange={(e) => update(i, { qty: digits(e.target.value) })}
                  className={inputCls}
                />
              </label>
              {s.breaks.map((b, j) => (
                <label key={j} className="block">
                  <div className={labelCls}>COMPARE {j + 1}</div>
                  <input
                    value={b}
                    inputMode="numeric"
                    placeholder="optional"
                    aria-label={`Size ${n} other quantity ${j + 1}`}
                    onChange={(e) => {
                      const next = [...s.breaks];
                      next[j] = digits(e.target.value);
                      update(i, { breaks: next });
                    }}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>

            {problem ? <div className="mt-2 text-sm text-[var(--attention)]">{problem}</div> : null}
          </div>
        );
      })}

      {sizes.length < maxExtra ? (
        <button
          type="button"
          onClick={add}
          className="mt-4 rounded-md border border-[var(--action-primary)] bg-[var(--surface-card)] px-4 py-2 text-sm font-medium text-[var(--action-primary)] hover:bg-[var(--surface-subtle)]"
        >
          + Add another size
        </button>
      ) : (
        <div className="mt-4 text-xs text-[var(--text-muted)]">A quote can have up to {maxExtra + 1} box sizes.</div>
      )}
    </div>
  );
}
