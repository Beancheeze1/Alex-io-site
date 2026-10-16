// components/quote/ShipToCard.tsx
//
// Step 30: shipping on the quote page (buyer) and the admin quote page
// (staff): freight terms, ship-to address and the freight it gives
// (POST /api/quote/ship-to). With prepaid & add the freight is part of the
// quote total. Staff can also type the freight (override).
// Step 36E: buyers see no terms / address form while freight isn't set up.
// Step 34B: "Saved addresses" from the buyer's other quotes at this shop
// (GET / POST /api/quote/ship-to/saved) fill the address fields.

"use client";

import * as React from "react";
import type { SavedAddress } from "@/app/lib/reorder-core";

export type FreightView = {
  status: "pickup" | "not_set_up" | "needs_zip" | "nothing_to_ship" | "estimated" | "free" | "override";
  terms: "prepaid_add" | "fob_origin" | "pickup";
  in_total: boolean;
  cost: number;
  estimate: number | null;
  mode: "parcel" | "ltl" | null;
  zone: number | null;
  miles: number | null;
  cartons: number;
  pallets: number;
  actual_lb: number;
  billable_lb: number;
  note: string;
  locked?: boolean;
};

export type FreightOptionsView = {
  set_up: boolean;
  allowed: ("prepaid_add" | "fob_origin" | "pickup")[];
  default_terms: "prepaid_add" | "fob_origin" | "pickup";
  free_over_usd: number;
};

export type ShipToView = {
  terms: "prepaid_add" | "fob_origin" | "pickup" | null;
  name: string | null;
  company: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  account: string | null;
  override_usd: number | null;
};

const TERMS: Record<FreightView["terms"], string> = {
  prepaid_add: "We ship it (freight added to this quote)",
  fob_origin: "FOB origin / collect (you pay the carrier)",
  pickup: "I'll pick it up",
};

const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function freightSummary(f: FreightView | null): string {
  if (!f) return "";
  switch (f.status) {
    case "pickup":
      return "Customer pickup: no freight.";
    case "not_set_up":
      return "Freight is quoted separately by the shop.";
    case "needs_zip":
      return "Add a ship-to ZIP to see freight.";
    case "nothing_to_ship":
      return "Freight shows once the quote has items.";
    case "free":
      return "Free freight.";
    case "override":
      return f.in_total ? `Freight ${usd(f.cost)} (set by the shop), included in the total.` : `Freight estimate ${usd(f.estimate || 0)} (you pay the carrier).`;
    default:
      return f.in_total
        ? `Freight ${usd(f.cost)}, included in the total.`
        : `Estimated freight ${usd(f.estimate || 0)} (you pay the carrier; not in the total).`;
  }
}

export default function ShipToCard({
  quoteNo,
  freight,
  options,
  shipTo,
  canEdit,
  staff = false,
}: {
  quoteNo: string;
  freight: FreightView | null;
  options: FreightOptionsView | null;
  shipTo: ShipToView | null;
  canEdit: boolean;
  staff?: boolean;
}) {
  const st = shipTo;
  const [terms, setTerms] = React.useState<FreightView["terms"]>(st?.terms || freight?.terms || options?.default_terms || "prepaid_add");
  const [zip, setZip] = React.useState(st?.zip || "");
  const [name, setName] = React.useState(st?.name || "");
  const [company, setCompany] = React.useState(st?.company || "");
  const [line1, setLine1] = React.useState(st?.line1 || "");
  const [line2, setLine2] = React.useState(st?.line2 || "");
  const [city, setCity] = React.useState(st?.city || "");
  const [state, setState] = React.useState(st?.state || "");
  const [account, setAccount] = React.useState(st?.account || "");
  const [override, setOverride] = React.useState(st?.override_usd != null ? String(st.override_usd) : "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<SavedAddress[]>([]);
  const [picked, setPicked] = React.useState("");

  React.useEffect(() => {
    if (!canEdit) return;
    let alive = true;
    fetch(`/api/quote/ship-to/saved?quote_no=${encodeURIComponent(quoteNo)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.addresses)) setSaved(j.addresses as SavedAddress[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canEdit, quoteNo]);

  const pick = (key: string) => {
    setPicked(key);
    const a = saved.find((x) => x.key === key);
    if (!a) return;
    setZip(a.zip || "");
    setName(a.name || "");
    setCompany(a.company || "");
    setLine1(a.line1 || "");
    setLine2(a.line2 || "");
    setCity(a.city || "");
    setState(a.state || "");
  };

  const forget = async () => {
    if (!picked) return;
    const r = await fetch("/api/quote/ship-to/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_no: quoteNo, hide: picked }),
    }).catch(() => null);
    if (r && r.ok) {
      setSaved((list) => list.filter((x) => x.key !== picked));
      setPicked("");
    }
  };

  if (!options && !freight) return null;
  const allowed = options?.allowed?.length ? options.allowed : (["prepaid_add", "fob_origin", "pickup"] as FreightView["terms"][]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { quote_no: quoteNo, terms, zip, name, company, line1, line2, city, state, account };
      if (staff) body.freight_override_usd = override.trim() === "" ? null : Number(override);
      const res = await fetch("/api/quote/ship-to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setError(j?.message || `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const box: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid var(--border)",
    background: "var(--surface-card)",
    padding: "12px 14px",
    marginTop: 4,
  };
  const input: React.CSSProperties = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    padding: "6px 9px",
    fontSize: 13,
  };
  const muted: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
  const field = (label: string, value: string, set: (v: string) => void, max: number, attr?: string) => (
    <label>
      <div style={muted}>{label}</div>
      <input style={input} aria-label={label} value={value} maxLength={max} data-ship-field={attr} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <div style={box} data-ship-to={freight?.status || "none"}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Shipping</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }} data-freight-summary>
        {freightSummary(freight)}
        {freight && (freight.status === "estimated" || freight.status === "free") && freight.note ? (
          <div style={muted}>{freight.note}</div>
        ) : null}
        {freight?.locked ? (
          <div style={muted} data-freight-locked>
            Kept at the freight from when this quote was accepted.
          </div>
        ) : null}
        {!canEdit && st == null && freight?.status !== "not_set_up" ? (
          <div style={muted}>To change shipping, open this quote from the link in your quote email.</div>
        ) : null}
      </div>

      {/* Step 36E: until the shop sets up freight, buyers only see "quoted separately" (staff keep the form) */}
      {canEdit && (staff || freight?.status !== "not_set_up") ? (
        <div style={{ marginTop: 10 }} data-ship-form>
          <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
            {allowed.map((t) => (
              <label key={t} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--text-primary)" }}>
                <input type="radio" name={`terms-${quoteNo}`} data-terms={t} checked={terms === t} onChange={() => setTerms(t)} />
                {TERMS[t]}
              </label>
            ))}
          </div>
          {terms !== "pickup" && saved.length ? (
            <div style={{ marginBottom: 8 }} data-saved-addresses>
              <div style={muted}>Saved addresses</div>
              <select style={input} aria-label="Saved addresses" value={picked} onChange={(e) => pick(e.target.value)} data-saved-address-select>
                <option value="">Pick one you&apos;ve used before…</option>
                {saved.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
              {picked ? (
                <button
                  type="button"
                  onClick={() => void forget()}
                  data-saved-address-remove
                  style={{ marginTop: 4, background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--text-muted)", textDecoration: "underline", cursor: "pointer" }}
                >
                  Remove from saved addresses
                </button>
              ) : null}
            </div>
          ) : null}
          {terms !== "pickup" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              {field("Ship-to ZIP", zip, setZip, 10, "zip")}
              {field("Name", name, setName, 120)}
              {field("Company", company, setCompany, 120)}
              {field("Address", line1, setLine1, 160)}
              {field("Address line 2", line2, setLine2, 160)}
              {field("City", city, setCity, 80)}
              {field("State (2 letters)", state, setState, 2)}
              {terms === "fob_origin" ? field("Your carrier account # (optional)", account, setAccount, 60) : null}
            </div>
          ) : null}
          {staff ? (
            <div style={{ marginTop: 8, maxWidth: 220 }}>
              {field("Freight override $ (blank = from table)", override, setOverride, 12, "override")}
            </div>
          ) : null}
          <button
            type="button"
            data-ship-save
            disabled={busy}
            onClick={save}
            style={{
              marginTop: 8,
              borderRadius: 8,
              border: "1px solid var(--action-primary)",
              background: "var(--action-primary)",
              color: "#fff",
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Saving…" : "Save shipping"}
          </button>
          {error ? <div style={{ ...muted, color: "var(--attention)", marginTop: 6 }}>{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
