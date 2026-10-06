// app/admin/corrugated/page.tsx
//
// Admin -> Corrugated: the shop's board grades, run and print rates, and
// scoring/layout (per-flute allowances + layout choices), with a live RSC
// blank preview. Saves through /api/admin/corrugated (admin only).
// Spec: "Custom Corrugated Box Pricing - Spec v1", Phase 1 Step 1.
// Settings only: nothing here changes live quote prices yet.

"use client";

import * as React from "react";
import Link from "next/link";
import {
  DEFAULT_FLUTES,
  DEFAULT_LAYOUT,
  JOINT_TYPES,
  RATE_FIELDS,
  ROUND_TO_OPTIONS,
  computeRscBlank,
  formatInches,
  parseInches,
  type FluteSpec,
  type JointType,
  type RateKey,
} from "@/lib/corrugated-blank";

type FluteRow = {
  key: string;
  flute: string;
  caliper: string;
  panel: string;
  lastAdj: string;
  depth: string;
  flap: string;
  joint: string;
};

type GradeRow = {
  key: string;
  id: number | null;
  name: string;
  flute: string;
  ect: string;
  cost: string;
  active: boolean;
  isDefault: boolean;
};

type LayoutState = {
  joint_type: JointType;
  flap_pct: string;
  round_to_in: number;
  edge_trim_in: string;
};

type ApiConfig = {
  ok: boolean;
  error?: string;
  message?: string;
  settings: Record<RateKey, number> & {
    joint_type: JointType;
    flap_pct: number;
    round_to_in: number;
    edge_trim_in: number;
  };
  flutes: FluteSpec[];
  grades: {
    id: number;
    name: string;
    flute: string;
    ect_label: string;
    cost_per_msf: number | null;
    active: boolean;
    is_default: boolean;
  }[];
};

let keySeq = 0;
const newKey = () => `row${++keySeq}`;

const INPUT =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)] focus:ring-1 focus:ring-[var(--action-primary)]";
const CARD =
  "rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 text-sm text-[var(--text-secondary)]";
const SECTION_LABEL = "text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]";
const TABLE_WRAP = "overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-page)]";
const THEAD = "bg-[var(--surface-subtle)] text-[var(--text-muted)]";
const TH = "px-2 py-2 font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 align-middle";
const SMALL_BTN =
  "rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
const FIELD_LABEL = "flex flex-col gap-1 text-[11px]";

const JOINT_LABELS: Record<JointType, string> = {
  glued: "Glued (adds the glue joint)",
  stitched: "Stitched (adds the glue joint)",
  taped: "Taped (no joint tab)",
};

const FLUTE_LABELS: Record<string, string> = {
  caliper_in: "caliper",
  panel_allow_in: "panel allowance",
  last_panel_adj_in: "last-panel adjustment",
  depth_allow_in: "depth allowance",
  flap_allow_in: "flap allowance",
  glue_joint_in: "glue joint",
};

function fluteToRow(f: FluteSpec): FluteRow {
  return {
    key: newKey(),
    flute: f.flute,
    caliper: formatInches(f.caliper_in),
    panel: formatInches(f.panel_allow_in),
    lastAdj: formatInches(f.last_panel_adj_in),
    depth: formatInches(f.depth_allow_in),
    flap: formatInches(f.flap_allow_in),
    joint: formatInches(f.glue_joint_in),
  };
}

/** Parsed FluteSpec, or an error message naming the flute and field. */
function rowToFlute(r: FluteRow): FluteSpec | string {
  const code = r.flute.trim().toUpperCase();
  const raw: Record<string, string> = {
    caliper_in: r.caliper,
    panel_allow_in: r.panel,
    last_panel_adj_in: r.lastAdj,
    depth_allow_in: r.depth,
    flap_allow_in: r.flap,
    glue_joint_in: r.joint,
  };
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k].trim() === "" && k === "last_panel_adj_in" ? 0 : parseInches(raw[k]);
    if (v === null) {
      return `Flute ${code || "(blank)"}: ${FLUTE_LABELS[k]} isn't a valid measurement (try 3/16 or 0.1875).`;
    }
    out[k] = v;
  }
  return { flute: code, ...(out as Omit<FluteSpec, "flute">) };
}

function parseNum(raw: string): number | null {
  const s = String(raw ?? "").replace(/[$,%\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const fi = (n: number) => formatInches(n);

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PriceCheckRow = {
  quantity: number;
  board_usd: number;
  converting_usd: number;
  print_run_usd: number;
  setup_usd: number;
  box_total_usd: number;
  min_applied: boolean;
  unit_price_usd: number;
  extended_usd: number;
};

type PriceCheckResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  grade?: { id: number; name: string; flute: string };
  blank?: { length_in: number; width_in: number; sqft_each_with_waste: number };
  colors?: number;
  sides?: number;
  plates_line_usd?: number;
  warnings?: string[];
  quantities?: PriceCheckRow[];
};

export default function CorrugatedSettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const [rates, setRates] = React.useState<Record<RateKey, string>>(
    () => Object.fromEntries(RATE_FIELDS.map((f) => [f.key, ""])) as Record<RateKey, string>,
  );
  const [layout, setLayout] = React.useState<LayoutState>({
    joint_type: DEFAULT_LAYOUT.joint_type,
    flap_pct: String(DEFAULT_LAYOUT.flap_pct),
    round_to_in: DEFAULT_LAYOUT.round_to_in,
    edge_trim_in: formatInches(DEFAULT_LAYOUT.edge_trim_in),
  });
  const [flutes, setFlutes] = React.useState<FluteRow[]>([]);
  const [grades, setGrades] = React.useState<GradeRow[]>([]);
  const [pv, setPv] = React.useState({ L: "12", W: "10", D: "8", gradeKey: "" });

  // Price check (uses SAVED settings via /api/admin/corrugated/price)
  const [pcQty, setPcQty] = React.useState("1000 5000");
  const [pcColors, setPcColors] = React.useState<("spot" | "flood")[]>([]);
  const [pcSides, setPcSides] = React.useState<1 | 2>(1);
  const [pcBusy, setPcBusy] = React.useState(false);
  const [pcResult, setPcResult] = React.useState<PriceCheckResponse | null>(null);

  const applyConfig = React.useCallback((cfg: ApiConfig) => {
    const s = cfg.settings;
    setRates(
      Object.fromEntries(RATE_FIELDS.map((f) => [f.key, String(s[f.key] ?? 0)])) as Record<RateKey, string>,
    );
    setLayout({
      joint_type: s.joint_type,
      flap_pct: String(s.flap_pct),
      round_to_in: s.round_to_in,
      edge_trim_in: formatInches(s.edge_trim_in),
    });
    setFlutes(cfg.flutes.map(fluteToRow));
    setGrades(
      cfg.grades.map((g) => ({
        key: newKey(),
        id: g.id,
        name: g.name,
        flute: g.flute,
        ect: g.ect_label,
        cost: g.cost_per_msf === null ? "" : String(g.cost_per_msf),
        active: g.active,
        isDefault: g.is_default,
      })),
    );
    setPv((p) => ({ ...p, gradeKey: "" }));
    setDirty(false);
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/corrugated", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as ApiConfig | null;
        if (!alive) return;
        if (!res.ok || !body?.ok) {
          throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
        }
        applyConfig(body);
      } catch (e: any) {
        if (alive) setLoadError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyConfig]);

  // Warn before leaving with unsaved changes.
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  React.useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const touch = () => {
    setDirty(true);
    setSaveMsg(null);
  };

  const setRate = (k: RateKey, v: string) => {
    setRates((r) => ({ ...r, [k]: v }));
    touch();
  };

  const setFluteField = (key: string, field: Exclude<keyof FluteRow, "key">, v: string) => {
    setFlutes((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: v } : r)));
    touch();
  };
  const addFlute = () => {
    setFlutes((rows) => [
      ...rows,
      { key: newKey(), flute: "", caliper: "", panel: "", lastAdj: "0", depth: "", flap: "", joint: "" },
    ]);
    touch();
  };
  const removeFlute = (key: string) => {
    setFlutes((rows) => rows.filter((r) => r.key !== key));
    touch();
  };

  const setGradeField = (key: string, patch: Partial<GradeRow>) => {
    setGrades((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touch();
  };
  const setDefaultGrade = (key: string) => {
    setGrades((rows) =>
      rows.map((r) => ({ ...r, isDefault: r.key === key, active: r.key === key ? true : r.active })),
    );
    touch();
  };
  const addGrade = () => {
    setGrades((rows) => [
      ...rows,
      {
        key: newKey(),
        id: null,
        name: "",
        flute: flutes[0]?.flute.trim().toUpperCase() || "C",
        ect: "",
        cost: "",
        active: true,
        isDefault: !rows.some((r) => r.isDefault),
      },
    ]);
    touch();
  };
  const removeGrade = (key: string) => {
    setGrades((rows) => {
      const next = rows.filter((r) => r.key !== key);
      if (!next.some((r) => r.isDefault)) {
        const firstActive = next.find((r) => r.active);
        if (firstActive) return next.map((r) => ({ ...r, isDefault: r.key === firstActive.key }));
      }
      return next;
    });
    touch();
  };

  const resetLayout = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    setFlutes(DEFAULT_FLUTES.map(fluteToRow));
    setLayout({
      joint_type: DEFAULT_LAYOUT.joint_type,
      flap_pct: String(DEFAULT_LAYOUT.flap_pct),
      round_to_in: DEFAULT_LAYOUT.round_to_in,
      edge_trim_in: formatInches(DEFAULT_LAYOUT.edge_trim_in),
    });
    touch();
    setSaveMsg({ kind: "ok", text: "Scoring and layout reset to defaults. Save to keep it." });
  };

  function buildPayload(): { payload: unknown } | { error: string } {
    const settings: Record<string, unknown> = {};
    for (const f of RATE_FIELDS) {
      const n = parseNum(rates[f.key]);
      if (n === null) return { error: `${f.label}: enter a number (0 if you don't charge it).` };
      settings[f.key] = n;
    }
    const flap = parseNum(layout.flap_pct);
    if (flap === null) return { error: "Flap size: enter a percent, e.g. 50." };
    const trim = layout.edge_trim_in.trim() === "" ? 0 : parseInches(layout.edge_trim_in);
    if (trim === null) return { error: "Edge trim: enter a measurement, e.g. 1/8 or 0." };
    settings.joint_type = layout.joint_type;
    settings.flap_pct = flap;
    settings.round_to_in = layout.round_to_in;
    settings.edge_trim_in = trim;

    const fl: FluteSpec[] = [];
    for (const r of flutes) {
      const v = rowToFlute(r);
      if (typeof v === "string") return { error: v };
      fl.push(v);
    }

    const gr: unknown[] = [];
    for (const g of grades) {
      let cost: number | null = null;
      if (g.cost.trim() !== "") {
        cost = parseNum(g.cost);
        if (cost === null) {
          return { error: `Board grade "${g.name || "(unnamed)"}": cost per MSF must be a number, or blank.` };
        }
      }
      gr.push({
        id: g.id,
        name: g.name.trim(),
        flute: g.flute.trim().toUpperCase(),
        ect_label: g.ect.trim(),
        cost_per_msf: cost,
        active: g.active,
        is_default: g.isDefault,
      });
    }
    return { payload: { settings, flutes: fl, grades: gr } };
  }

  async function save() {
    const built = buildPayload();
    if ("error" in built) {
      setSaveMsg({ kind: "error", text: built.error });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/corrugated", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.payload),
      });
      const body = (await res.json().catch(() => null)) as ApiConfig | null;
      if (!res.ok || !body?.ok) {
        setSaveMsg({ kind: "error", text: body?.message || body?.error || `Save failed (HTTP ${res.status}).` });
        return;
      }
      applyConfig(body);
      setSaveMsg({ kind: "ok", text: "Saved." });
    } catch (e: any) {
      setSaveMsg({ kind: "error", text: String(e?.message || e) });
    } finally {
      setSaving(false);
    }
  }

  async function runPriceCheck() {
    const L = parseInches(pv.L);
    const W = parseInches(pv.W);
    const D = parseInches(pv.D);
    if (L === null || W === null || D === null) {
      setPcResult({ ok: false, message: "Enter the inside length, width and depth in the blank preview." });
      return;
    }
    const quantities = pcQty
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
    const selected = grades.find((g) => g.key === pv.gradeKey);
    setPcBusy(true);
    setPcResult(null);
    try {
      const res = await fetch("/api/admin/corrugated/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          L,
          W,
          D,
          quantities,
          grade_id: selected?.id ?? null,
          colors: pcColors,
          sides: pcSides,
        }),
      });
      const body = (await res.json().catch(() => null)) as PriceCheckResponse | null;
      setPcResult(body ?? { ok: false, message: `Price check failed (HTTP ${res.status}).` });
    } catch (e: any) {
      setPcResult({ ok: false, message: String(e?.message || e) });
    } finally {
      setPcBusy(false);
    }
  }

  const fluteCodes = Array.from(new Set(flutes.map((f) => f.flute.trim().toUpperCase()).filter(Boolean)));

  const preview = React.useMemo(() => {
    const L = parseInches(pv.L);
    const W = parseInches(pv.W);
    const D = parseInches(pv.D);
    if (L === null || W === null || D === null || L <= 0 || W <= 0 || D <= 0) {
      return { error: "Enter an inside length, width and depth." };
    }
    const active = grades.filter((g) => g.active);
    const grade = active.find((g) => g.key === pv.gradeKey) || active.find((g) => g.isDefault) || active[0];
    if (!grade) return { error: "Add an active board grade to preview a blank." };
    const code = grade.flute.trim().toUpperCase();
    const row = flutes.find((f) => f.flute.trim().toUpperCase() === code);
    if (!row) return { error: `There's no scoring row for flute ${code}. Add it under Scoring and layout.` };
    const flute = rowToFlute(row);
    if (typeof flute === "string") return { error: flute };
    const waste = parseNum(rates.waste_pct);
    const flap = parseNum(layout.flap_pct);
    const trim = layout.edge_trim_in.trim() === "" ? 0 : parseInches(layout.edge_trim_in);
    if (waste === null || flap === null || trim === null) {
      return { error: "Fix the waste %, flap size or edge trim to see the preview." };
    }
    const blank = computeRscBlank({ L, W, D }, flute, {
      joint_type: layout.joint_type,
      flap_pct: flap,
      round_to_in: layout.round_to_in,
      edge_trim_in: trim,
      waste_pct: waste,
    });
    const cost = grade.cost.trim() === "" ? null : parseNum(grade.cost);
    const jointVal = layout.joint_type === "taped" ? 0 : flute.glue_joint_in;
    return { blank, gradeName: grade.name || "unnamed grade", flute, L, W, D, flap, trim, waste, cost, jointVal };
  }, [pv, grades, flutes, rates.waste_pct, layout]);

  const saveBar = (
    <div className="flex items-center gap-3">
      {saveMsg ? (
        <span
          className={`text-[11px] ${
            saveMsg.kind === "ok" ? "text-[var(--status-success-text)]" : "text-[var(--attention)]"
          }`}
        >
          {saveMsg.text}
        </span>
      ) : dirty ? (
        <span className="text-[11px] text-[var(--text-muted)]">Unsaved changes</span>
      ) : null}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-md bg-[var(--action-primary)] px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save corrugated settings"}
      </button>
    </div>
  );

  if (loading || loadError) {
    return (
      <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h1 className="text-2xl font-medium tracking-tight">Corrugated</h1>
          {loading ? (
            <p className="mt-3 text-xs text-[var(--text-muted)]">Loading corrugated settings…</p>
          ) : (
            <p className="mt-3 text-xs text-[var(--attention)]">
              Couldn&apos;t load corrugated settings: <span className="font-mono">{loadError}</span>
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Corrugated</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Your board grades, run and print rates, and how you score and lay out a blank. Custom-size box
              quotes will be priced from these settings.
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">
              Saving here doesn&apos;t change any live quote prices yet.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <Link
              href="/admin"
              className="text-xs text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
            >
              &larr; Back to admin home
            </Link>
            {saveBar}
          </div>
        </header>

        {/* Board grades */}
        <section className={`${CARD} mb-6`}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className={SECTION_LABEL}>Board grades</div>
              <p className="mt-1 text-xs">
                One row per grade you run. Buyers choose from active grades; the default is used when a buyer
                picks &ldquo;Not sure — recommend one&rdquo;.
              </p>
            </div>
            <button type="button" onClick={addGrade} className={SMALL_BTN}>
              + Add grade
            </button>
          </div>
          <div className={TABLE_WRAP}>
            <table className="min-w-full text-left text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Grade name</th>
                  <th className={TH}>Flute</th>
                  <th className={TH}>ECT / test</th>
                  <th className={TH}>Cost per MSF ($)</th>
                  <th className={`${TH} text-center`}>Active</th>
                  <th className={`${TH} text-center`}>Default</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {grades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-[var(--text-muted)]">
                      No board grades yet. Add the grades you run.
                    </td>
                  </tr>
                ) : (
                  grades.map((g) => {
                    const code = g.flute.trim().toUpperCase();
                    const options = fluteCodes.includes(code) ? fluteCodes : [code, ...fluteCodes];
                    return (
                      <tr key={g.key} className="border-t border-[var(--border)]">
                        <td className={TD}>
                          <input
                            className={INPUT}
                            value={g.name}
                            placeholder="e.g. 32 ECT C"
                            aria-label="Grade name"
                            onChange={(e) => setGradeField(g.key, { name: e.target.value })}
                          />
                        </td>
                        <td className={`${TD} w-28`}>
                          <select
                            className={INPUT}
                            value={code}
                            aria-label="Flute"
                            onChange={(e) => setGradeField(g.key, { flute: e.target.value })}
                          >
                            {options.map((c) => (
                              <option key={c || "none"} value={c}>
                                {fluteCodes.includes(c) ? c : `${c || "(none)"}: no scoring row`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={`${TD} w-28`}>
                          <input
                            className={INPUT}
                            value={g.ect}
                            placeholder="32 ECT"
                            aria-label="ECT / test"
                            onChange={(e) => setGradeField(g.key, { ect: e.target.value })}
                          />
                        </td>
                        <td className={`${TD} w-32`}>
                          <input
                            className={INPUT}
                            inputMode="decimal"
                            value={g.cost}
                            placeholder="Not set"
                            aria-label="Cost per MSF"
                            onChange={(e) => setGradeField(g.key, { cost: e.target.value })}
                          />
                        </td>
                        <td className={`${TD} text-center`}>
                          <input
                            type="checkbox"
                            checked={g.active}
                            aria-label="Active"
                            onChange={(e) => setGradeField(g.key, { active: e.target.checked })}
                          />
                        </td>
                        <td className={`${TD} text-center`}>
                          <input
                            type="radio"
                            name="default-grade"
                            checked={g.isDefault}
                            aria-label="Default grade"
                            onChange={() => setDefaultGrade(g.key)}
                          />
                        </td>
                        <td className={`${TD} text-right`}>
                          <button
                            type="button"
                            className={SMALL_BTN}
                            aria-label={`Remove ${g.name || "grade"}`}
                            onClick={() => removeGrade(g.key)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-faint)]">
            A grade with no cost can&apos;t be priced yet. To stop offering a grade without deleting it, untick
            Active.
          </p>
        </section>

        {/* Run and print rates */}
        <section className={`${CARD} mb-6`}>
          <div className={SECTION_LABEL}>Run and print rates</div>
          <p className="mb-3 mt-1 text-xs">Dollar rates start at 0. Set them before Boxes-only quoting goes live.</p>
          <div className={TABLE_WRAP}>
            <table className="min-w-full text-left text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Setting</th>
                  <th className={TH}>Value</th>
                  <th className={TH}>Unit</th>
                  <th className={TH}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {RATE_FIELDS.map((f) => (
                  <tr key={f.key} className="border-t border-[var(--border)]">
                    <td className={`${TD} text-[var(--text-primary)]`}>{f.label}</td>
                    <td className={`${TD} w-36`}>
                      <input
                        className={INPUT}
                        inputMode="decimal"
                        value={rates[f.key]}
                        aria-label={f.label}
                        onChange={(e) => setRate(f.key, e.target.value)}
                      />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{f.unit}</td>
                    <td className={`${TD} text-[var(--text-muted)]`}>{f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Scoring and layout */}
        <section className={`${CARD} mb-6`}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className={SECTION_LABEL}>Scoring and layout</div>
              <p className="mt-1 max-w-3xl text-xs">
                How you score and lay out an RSC blank, per flute. Enter inches as fractions (3/16, 1 3/8) or
                decimals (0.1875). Check the result in the blank preview below against a box you already run.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addFlute} className={SMALL_BTN}>
                + Add flute
              </button>
              <button type="button" onClick={resetLayout} className={SMALL_BTN}>
                {confirmReset ? "Click again to reset" : "Reset to defaults"}
              </button>
            </div>
          </div>

          <div className={TABLE_WRAP}>
            <table className="min-w-full text-left text-xs">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Flute</th>
                  <th className={TH}>Caliper</th>
                  <th className={TH}>Panel allowance (each of 4)</th>
                  <th className={TH}>Last-panel adjustment</th>
                  <th className={TH}>Depth allowance</th>
                  <th className={TH}>Flap allowance (each)</th>
                  <th className={TH}>Glue joint</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {flutes.map((r) => {
                  const code = r.flute.trim().toUpperCase() || "new flute";
                  const cell = (field: Exclude<keyof FluteRow, "key">, label: string) => (
                    <td className={TD}>
                      <input
                        className={INPUT}
                        value={r[field]}
                        aria-label={`${code} ${label}`}
                        onChange={(e) => setFluteField(r.key, field, e.target.value)}
                      />
                    </td>
                  );
                  return (
                    <tr key={r.key} className="border-t border-[var(--border)]">
                      <td className={`${TD} w-20`}>
                        <input
                          className={INPUT}
                          value={r.flute}
                          placeholder="C"
                          aria-label="Flute"
                          onChange={(e) => setFluteField(r.key, "flute", e.target.value.toUpperCase())}
                        />
                      </td>
                      {cell("caliper", "caliper")}
                      {cell("panel", "panel allowance")}
                      {cell("lastAdj", "last-panel adjustment")}
                      {cell("depth", "depth allowance")}
                      {cell("flap", "flap allowance")}
                      {cell("joint", "glue joint")}
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          className={SMALL_BTN}
                          aria-label={`Remove flute ${code}`}
                          onClick={() => removeFlute(r.key)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Joint type</span>
              <select
                className={INPUT}
                value={layout.joint_type}
                onChange={(e) => {
                  setLayout((l) => ({ ...l, joint_type: e.target.value as JointType }));
                  touch();
                }}
              >
                {JOINT_TYPES.map((j) => (
                  <option key={j} value={j}>
                    {JOINT_LABELS[j]}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Flap size (% of width, per flap)</span>
              <input
                className={INPUT}
                inputMode="decimal"
                value={layout.flap_pct}
                onChange={(e) => {
                  setLayout((l) => ({ ...l, flap_pct: e.target.value }));
                  touch();
                }}
              />
              <span className="text-[var(--text-faint)]">50% = flaps meet at the center (standard RSC).</span>
            </label>
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Round blank up to</span>
              <select
                className={INPUT}
                value={String(layout.round_to_in)}
                onChange={(e) => {
                  setLayout((l) => ({ ...l, round_to_in: Number(e.target.value) }));
                  touch();
                }}
              >
                {ROUND_TO_OPTIONS.map((o) => (
                  <option key={o} value={String(o)}>
                    {`${formatInches(o)} in`}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Edge trim per blank (in)</span>
              <input
                className={INPUT}
                value={layout.edge_trim_in}
                onChange={(e) => {
                  setLayout((l) => ({ ...l, edge_trim_in: e.target.value }));
                  touch();
                }}
              />
              <span className="text-[var(--text-faint)]">
                Added to blank length and width. 0 if you only use waste %.
              </span>
            </label>
          </div>
        </section>

        {/* Blank preview */}
        <section className={CARD}>
          <div className={SECTION_LABEL}>Blank preview</div>
          <p className="mb-3 mt-1 text-xs">
            Enter a box you already make and compare this blank with yours. It uses the values on this page,
            saved or not.
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            {(["L", "W", "D"] as const).map((k) => (
              <label key={k} className={FIELD_LABEL}>
                <span className="text-[var(--text-primary)]">
                  {k === "L" ? "Inside length (in)" : k === "W" ? "Inside width (in)" : "Inside depth (in)"}
                </span>
                <input
                  className={INPUT}
                  value={pv[k]}
                  onChange={(e) => setPv((p) => ({ ...p, [k]: e.target.value }))}
                />
              </label>
            ))}
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Board grade</span>
              <select
                className={INPUT}
                value={pv.gradeKey}
                onChange={(e) => setPv((p) => ({ ...p, gradeKey: e.target.value }))}
              >
                <option value="">Default grade</option>
                {grades
                  .filter((g) => g.active)
                  .map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.name || "(unnamed)"}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {"error" in preview ? (
            <p className="mt-3 text-xs text-[var(--attention)]">{preview.error}</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-page)] p-4">
                <div className="text-[11px] text-[var(--text-muted)]">
                  RSC blank: {preview.gradeName}, {preview.flute.flute} flute
                </div>
                <div className="mt-1 text-lg font-medium text-[var(--text-primary)]" data-testid="blank-size">
                  {fi(preview.blank.length_in)} × {fi(preview.blank.width_in)} in
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  {preview.blank.length_in.toFixed(4)} × {preview.blank.width_in.toFixed(4)} in
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[11px]">
                  <dt>Board per box</dt>
                  <dd className="text-right text-[var(--text-primary)]">{preview.blank.sqft_each.toFixed(3)} sq ft</dd>
                  <dt>With {preview.waste}% waste</dt>
                  <dd className="text-right text-[var(--text-primary)]">
                    {preview.blank.sqft_each_with_waste.toFixed(3)} sq ft
                  </dd>
                  <dt>Board per 1,000 boxes</dt>
                  <dd className="text-right text-[var(--text-primary)]">
                    {preview.blank.sqft_each_with_waste.toFixed(3)} MSF
                  </dd>
                  <dt>Board cost per box</dt>
                  <dd className="text-right text-[var(--text-primary)]">
                    {preview.cost === null
                      ? "Set a cost per MSF"
                      : `$${((preview.blank.sqft_each_with_waste / 1000) * preview.cost).toFixed(4)}`}
                  </dd>
                </dl>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-page)] p-4 text-[11px] leading-relaxed">
                <div className="text-[var(--text-muted)]">How it was worked out (inches)</div>
                <p className="mt-2">
                  <span className="text-[var(--text-primary)]">Length</span> = 2 × {fi(preview.L)} + 2 ×{" "}
                  {fi(preview.W)} + 4 × {fi(preview.flute.panel_allow_in)} panel +{" "}
                  {fi(preview.flute.last_panel_adj_in)} last panel + {fi(preview.jointVal)} joint +{" "}
                  {fi(preview.trim)} trim = {fi(preview.blank.raw_length_in)}
                </p>
                <p className="mt-2">
                  <span className="text-[var(--text-primary)]">Width</span> = {fi(preview.D)} +{" "}
                  {fi(preview.flute.depth_allow_in)} depth + 2 × ({preview.flap}% × {fi(preview.W)} +{" "}
                  {fi(preview.flute.flap_allow_in)} flap) + {fi(preview.trim)} trim ={" "}
                  {fi(preview.blank.raw_width_in)}
                </p>
                <p className="mt-2 text-[var(--text-faint)]">
                  Both rounded up to the nearest {fi(layout.round_to_in)} in.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Price check */}
        <section className={`${CARD} mt-6`}>
          <div className={SECTION_LABEL}>Price check</div>
          <p className="mb-3 mt-1 text-xs">
            Prices the box from the blank preview (size and board grade) using your <strong>saved</strong>{" "}
            settings, the same way custom-size box quotes will be priced.
            {dirty ? " You have unsaved changes; save first to include them." : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Quantities (up to 4, e.g. 1000 5000)</span>
              <input className={INPUT} value={pcQty} onChange={(e) => setPcQty(e.target.value)} />
            </label>
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Printing</span>
              <select
                className={INPUT}
                value={String(pcColors.length)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setPcColors((c) => Array.from({ length: n }, (_, i) => c[i] ?? "spot"));
                }}
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={String(n)}>
                    {n === 0 ? "No print" : `${n} color${n > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_LABEL}>
              <span className="text-[var(--text-primary)]">Sides</span>
              <select
                className={INPUT}
                disabled={pcColors.length === 0}
                value={String(pcSides)}
                onChange={(e) => setPcSides(e.target.value === "2" ? 2 : 1)}
              >
                <option value="1">One side</option>
                <option value="2">Two sides</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={runPriceCheck}
                disabled={pcBusy}
                className="rounded-md bg-[var(--action-primary)] px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pcBusy ? "Pricing…" : "Price it"}
              </button>
            </div>
          </div>

          {pcColors.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-3">
              {pcColors.map((c, i) => (
                <label key={i} className={FIELD_LABEL}>
                  <span className="text-[var(--text-primary)]">Color {i + 1} coverage</span>
                  <select
                    className={INPUT}
                    value={c}
                    onChange={(e) => {
                      const v: "spot" | "flood" = e.target.value === "flood" ? "flood" : "spot";
                      setPcColors((cs) => cs.map((x, j) => (j === i ? v : x)));
                    }}
                  >
                    <option value="spot">Spot</option>
                    <option value="flood">Flood</option>
                  </select>
                </label>
              ))}
            </div>
          ) : null}

          {pcResult ? (
            !pcResult.ok ? (
              <p className="mt-3 text-xs text-[var(--attention)]" data-testid="price-check-error">
                {pcResult.message || pcResult.error}
              </p>
            ) : (
              <div className="mt-4" data-testid="price-check-result">
                <div className="mb-2 text-[11px] text-[var(--text-muted)]">
                  {pcResult.grade?.name} ({pcResult.grade?.flute} flute)
                  {pcResult.blank
                    ? ` · blank ${fi(pcResult.blank.length_in)} × ${fi(pcResult.blank.width_in)} in · ${pcResult.blank.sqft_each_with_waste.toFixed(3)} sq ft per box with waste`
                    : ""}
                  {pcResult.colors
                    ? ` · ${pcResult.colors} color${pcResult.colors > 1 ? "s" : ""}, ${pcResult.sides === 2 ? "two sides" : "one side"}`
                    : " · no print"}
                </div>
                <div className={TABLE_WRAP}>
                  <table className="min-w-full text-left text-xs">
                    <thead className={THEAD}>
                      <tr>
                        <th className={TH}>Quantity</th>
                        <th className={`${TH} text-right`}>Board</th>
                        <th className={`${TH} text-right`}>Converting</th>
                        <th className={`${TH} text-right`}>Print run</th>
                        <th className={`${TH} text-right`}>Setup</th>
                        <th className={`${TH} text-right`}>Box total</th>
                        <th className={`${TH} text-right`}>Unit price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pcResult.quantities ?? []).map((qr) => (
                        <tr key={qr.quantity} className="border-t border-[var(--border)]">
                          <td className={TD}>{qr.quantity.toLocaleString("en-US")}</td>
                          <td className={`${TD} text-right`}>{usd(qr.board_usd)}</td>
                          <td className={`${TD} text-right`}>{usd(qr.converting_usd)}</td>
                          <td className={`${TD} text-right`}>{usd(qr.print_run_usd)}</td>
                          <td className={`${TD} text-right`}>{usd(qr.setup_usd)}</td>
                          <td className={`${TD} text-right`}>
                            {usd(qr.box_total_usd)}
                            {qr.min_applied ? " (minimum)" : ""}
                          </td>
                          <td className={`${TD} text-right font-medium text-[var(--text-primary)]`}>
                            ${qr.unit_price_usd.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pcResult.colors ? (
                  <p className="mt-2 text-[11px]">
                    Plates (one time, with markup): {usd(pcResult.plates_line_usd ?? 0)}
                  </p>
                ) : null}
                {pcResult.warnings && pcResult.warnings.length ? (
                  <p className="mt-2 text-[11px] text-[var(--attention)]">Check: {pcResult.warnings.join(" ")}</p>
                ) : null}
                <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                  Board, converting, print run and setup are your costs before markup. Box total and unit price
                  include markup and the minimum order.
                </p>
              </div>
            )
          ) : null}
        </section>

        <div className="mt-6 flex justify-end">{saveBar}</div>
      </div>
    </main>
  );
}
