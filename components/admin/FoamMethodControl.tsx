// components/admin/FoamMethodControl.tsx
//
// Step 23: "Foam cutting" on the admin quote page (Pricing snapshot card).
// Staff pick how the foam is cut: Auto (the shop's die cutoff), CNC short run
// (no tooling) or Steel-rule die + press, and can mark that the customer
// already owns the die (no die charge). Saving reloads the page.
// Hidden on quotes with no foam.

"use client";

import * as React from "react";

type Choice = "auto" | "cnc" | "die";

type Info = {
  has_foam: boolean;
  method: Choice;
  die_owned: boolean;
  resolved: "cnc" | "die" | null;
  cutoff: number;
  cnc_on: boolean;
  die_on: boolean;
  model: 1 | 2;
  locked: boolean;
  detail: {
    cut_in_per_piece?: number;
    rule_in_total?: number;
    dies?: number;
    glue_lines?: number;
    layers?: number;
    cavity_ci?: number;
  } | null;
};

const selectStyle: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "4px 8px",
  fontSize: 12,
};

export default function FoamMethodControl({ quoteNo }: { quoteNo: string }) {
  const [info, setInfo] = React.useState<Info | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/quotes/foam-run-method?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        setInfo({
          has_foam: j.has_foam === true,
          method: j.method === "cnc" || j.method === "die" ? j.method : "auto",
          die_owned: j.die_owned === true,
          resolved: j.resolved === "cnc" || j.resolved === "die" ? j.resolved : null,
          cutoff: Number(j.cutoff) || 0,
          cnc_on: j.cnc_on === true,
          die_on: j.die_on === true,
          model: j.model === 1 ? 1 : 2,
          locked: j.locked === true,
          detail: j.detail ?? null,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteNo]);

  if (!info || !info.has_foam) return null;

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/quotes/foam-run-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, ...body }),
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

  const d = info.detail || {};
  const facts = [
    d.cut_in_per_piece != null ? `${Number(d.cut_in_per_piece).toFixed(1)}" of cut per part` : null,
    d.rule_in_total != null ? `${Number(d.rule_in_total).toFixed(1)}" of rule` : null,
    d.dies ? `${d.dies} die${d.dies > 1 ? "s" : ""}` : null,
    d.layers ? `${d.layers} layer${d.layers > 1 ? "s" : ""}` : null,
    d.glue_lines ? `${d.glue_lines} glue line${d.glue_lines > 1 ? "s" : ""}` : null,
    d.cavity_ci ? `${Number(d.cavity_ci).toFixed(1)} cu in of cavities removed` : null,
  ].filter(Boolean);

  let status: string;
  if (info.model === 1) {
    status = "Priced before Step 23 (old die-cut fee, cavities not subtracted). Reprice at today's rates to switch.";
  } else if (!info.cnc_on && !info.die_on) {
    status = "No CNC or die rates set for this shop, so the old flat die-cut fee applies. Set them in Admin → Settings.";
  } else {
    const auto =
      info.die_on && info.cnc_on && info.cutoff > 0
        ? `Auto: steel-rule die at ${info.cutoff.toLocaleString("en-US")}+ parts, CNC below.`
        : info.die_on && !info.cnc_on
          ? "Auto: steel-rule die (no CNC rates set)."
          : !info.die_on
            ? "Auto: CNC (no die rates set)."
            : "Auto: CNC (set a die cutoff in Admin → Settings to switch to a die by quantity).";
    status = `${auto} This quote: ${info.resolved === "die" ? "steel-rule die + press" : "CNC short run"}.`;
  }

  return (
    <div style={{ marginBottom: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }} data-foam-method-control>
      <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-primary)" }}>Foam cutting</span>
        <select
          value={info.method}
          disabled={busy || info.locked || info.model === 1}
          onChange={(e) => {
            const v = e.target.value === "cnc" ? "cnc" : e.target.value === "die" ? "die" : "auto";
            if (v !== info.method) save({ method: v });
          }}
          style={selectStyle}
        >
          <option value="auto">Auto (by quantity)</option>
          <option value="cnc" disabled={!info.cnc_on}>CNC short run (no tooling)</option>
          <option value="die" disabled={!info.die_on}>Steel-rule die + press</option>
        </select>
        {info.resolved === "die" || info.method === "die" ? (
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={info.die_owned}
              disabled={busy || info.locked || info.model === 1}
              onChange={(e) => save({ die_owned: e.target.checked })}
            />
            <span>Customer owns the die</span>
          </label>
        ) : null}
        {busy ? <span>Saving…</span> : null}
      </label>
      <div style={{ marginTop: 4 }}>
        {info.locked ? "Released quote: revise it to change how the foam is cut." : status}
      </div>
      {facts.length > 0 ? <div style={{ marginTop: 2 }}>{facts.join(" · ")}</div> : null}
      {note ? <div style={{ marginTop: 6, color: "var(--attention)" }}>{note}</div> : null}
    </div>
  );
}
