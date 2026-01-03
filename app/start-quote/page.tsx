// app/start-quote/page.tsx
//
// Start Real Quote (lead capture → OPEN EDITOR ONLY)
// - NO email sending
// - NO orchestrate call
// - Builds a seeded /quote/layout URL and navigates there
// - Adds explicit cavity-layer selector to avoid “wrong layer” seeding
//
// Path A: does NOT change any email flow code. This page bypasses email entirely.

"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold tracking-widest text-sky-300/80">
        {label}
      </div>
      {children}
    </label>
  );
}

function toNumOrNull(s: string) {
  const n = Number(String(s || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildQuoteNo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `Q-AI-${y}${m}${day}-${hh}${mm}${ss}`;
}

function normalizeDims(input: string) {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[×\*]/g, "x")
    .replace(/,/g, "x")
    .replace(/\s+/g, "");

  const cleaned = s.replace(/[^0-9.x]/g, "");

  const parts = cleaned.split("x").filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]}x${parts[1]}x${parts[2]}`;
  }
  return cleaned;
}

function extractFirstCavity(cavitiesText: string) {
  const s = String(cavitiesText || "")
    .replace(/[×\*]/g, "x")
    .replace(/\s+/g, "");

  const m = s.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return `${m[1]}x${m[2]}x${m[3]}`;
}

type MaterialOption = {
  id: number;
  name: string;
  family?: string | null;
  density_lb_ft3?: number | null;
};

// Payload shape sent by the splash widget. Keep it permissive.
type PrefillPayload = {
  source?: string;
  createdAtIso?: string;
  outside?: { l?: string; w?: string; h?: string; units?: string };
  qty?: string;

  shipMode?: string;
  insertType?: string;
  pocketsOn?: string;
  holding?: string;
  pocketCount?: string;

  material?: { mode?: string; text?: string };

  // NEW: layers + cavity seed from widget
  layerCount?: string;
  layerThicknesses?: string[];
  firstCavity?: string;

  notes?: string;
};

function safeDecodePrefill(raw: string | null): PrefillPayload | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const obj = JSON.parse(decoded) as PrefillPayload;
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

function normalizeEnum<T extends string>(v: string, allowed: readonly T[]): T | "" {
  const s = String(v || "").trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : "";
}

// Best-effort parse for “2 layers 1" top pad + 3" base/body” inside notes.
// Only applies when it’s unambiguous.
function tryInferLayersFromText(raw: string): { layerCount?: number; thicknesses?: number[] } {
  const s = String(raw || "").toLowerCase();

  const mLayers = s.match(/(\d+)\s*layers?/);
  const layerCount = mLayers ? Math.max(1, Math.min(4, Number(mLayers[1]) || 0)) : undefined;

  const mTop =
    s.match(/(\d+(?:\.\d+)?)\s*(?:\"|inches?|inch|in)\s*(?:top\s*pad|lid|cap)/) ?? null;

  const mBase =
    s.match(/(\d+(?:\.\d+)?)\s*(?:\"|inches?|inch|in)\s*(?:base|body|bottom|main)/) ?? null;

  const top = mTop ? Number(mTop[1]) : null;
  const base = mBase ? Number(mBase[1]) : null;

  const topOk = top != null && Number.isFinite(top) && top > 0;
  const baseOk = base != null && Number.isFinite(base) && base > 0;

  if (layerCount === 2 && topOk && baseOk) {
    return { layerCount: 2, thicknesses: [base as number, top as number] };
  }

  return { layerCount };
}

export default function StartQuotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [name, setName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");

  const [qty, setQty] = React.useState("");
  const [foam, setFoam] = React.useState("");
  const [size, setSize] = React.useState("");
  const [cavities, setCavities] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const [shipMode, setShipMode] = React.useState<"" | "box" | "mailer" | "unsure">("");
  const [insertType, setInsertType] = React.useState<"" | "single" | "set" | "unsure">("");
  const [pocketsOn, setPocketsOn] = React.useState<"" | "base" | "top" | "both" | "unsure">("");
  const [holding, setHolding] = React.useState<"" | "pockets" | "loose" | "unsure">("");
  const [pocketCount, setPocketCount] = React.useState<"" | "1" | "2" | "3+" | "unsure">("");
  const [materialMode, setMaterialMode] = React.useState<"" | "recommend" | "known">("");
  const [materialText, setMaterialText] = React.useState("");

  const [attemptedOpen, setAttemptedOpen] = React.useState(false);

  const [materialOptions, setMaterialOptions] = React.useState<MaterialOption[]>([]);
  const [materialId, setMaterialId] = React.useState<string>("");

  const [layerCount, setLayerCount] = React.useState<number>(3);
  const [layerThicknesses, setLayerThicknesses] = React.useState<number[]>([1, 1, 1]);

  const [cavityLayerIndex, setCavityLayerIndex] = React.useState<number>(2);

  const [isWidgetPrefill, setIsWidgetPrefill] = React.useState(false);

  const prefillAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (prefillAppliedRef.current) return;

    const raw = searchParams?.get("prefill") ?? null;
    const payload = safeDecodePrefill(raw);
    if (!payload) {
      prefillAppliedRef.current = true;
      return;
    }

    const fromWidget = payload.source === "splash-widget";
    setIsWidgetPrefill(fromWidget);

    const l = payload.outside?.l ? String(payload.outside.l).trim() : "";
    const w = payload.outside?.w ? String(payload.outside.w).trim() : "";
    const h = payload.outside?.h ? String(payload.outside.h).trim() : "";
    if (l && w && h) setSize(`${l}x${w}x${h}`);

    if (payload.qty != null) {
      const q = String(payload.qty).replace(/[^\d]/g, "");
      if (q) setQty(q);
    }

    const ship = normalizeEnum(payload.shipMode || "", ["box", "mailer", "unsure"] as const);
    if (ship) setShipMode(ship);

    const ins = normalizeEnum(payload.insertType || "", ["single", "set", "unsure"] as const);
    if (ins) setInsertType(ins);

    const pocOn = normalizeEnum(payload.pocketsOn || "", ["base", "top", "both", "unsure"] as const);
    if (pocOn) setPocketsOn(pocOn);

    const hold = normalizeEnum(payload.holding || "", ["pockets", "loose", "unsure"] as const);
    if (hold) setHolding(hold);

    const pc = normalizeEnum(payload.pocketCount || "", ["1", "2", "3+", "unsure"] as const);
    if (pc) setPocketCount(pc);

    const mm = normalizeEnum(payload.material?.mode || "", ["recommend", "known"] as const);
    if (mm) setMaterialMode(mm);

    const mt = payload.material?.text ? String(payload.material.text).trim() : "";
    if (mt) setMaterialText(mt);

    if (mm === "known" && mt) {
      setFoam(mt);
    }

    // NEW: if widget provides a cavity seed, prefill the cavities input
    const seedCav = payload.firstCavity ? String(payload.firstCavity).trim() : "";
    if (seedCav) {
      setCavities((prev) => (String(prev || "").trim() ? prev : seedCav));
    }

    // Best-effort: infer layers + thicknesses from widget notes when clear (kept)
    const widgetNotes = payload.notes ? String(payload.notes).trim() : "";
    if (widgetNotes) {
      const inferred = tryInferLayersFromText(widgetNotes);
      if (inferred.layerCount && Number.isFinite(inferred.layerCount)) {
        setLayerCount(inferred.layerCount);
      }
      if (inferred.thicknesses && inferred.thicknesses.length) {
        setLayerThicknesses((prev) => {
          const next = [...prev];
          for (let i = 0; i < inferred.thicknesses!.length; i++) {
            next[i] = inferred.thicknesses![i];
          }
          return next.slice(0, inferred.thicknesses!.length);
        });
        setCavityLayerIndex((prev) => (Number.isFinite(prev) ? prev : 1));
      }
    }

    const noteLines: string[] = [];

    if (ship)
      noteLines.push(
        `Shipping: ${ship === "box" ? "Box" : ship === "mailer" ? "Mailer" : "Not sure"}`
      );
    if (ins)
      noteLines.push(
        `Insert: ${ins === "single" ? "Single" : ins === "set" ? "Set (base + top)" : "Not sure"}`
      );
    if (ins === "set" && pocOn) noteLines.push(`Pockets on: ${pocOn}`);
    if (hold) {
      if (hold === "pockets") noteLines.push(`Holding: Cut-out pockets${pc ? ` (${pc})` : ""}`);
      if (hold === "loose") noteLines.push("Holding: Loose / no pockets");
      if (hold === "unsure") noteLines.push("Holding: Not sure yet");
    }
    if (mm === "recommend") noteLines.push("Material: Recommended");
    if (mm === "known" && mt) noteLines.push(`Material: ${mt}`);
    if (seedCav) noteLines.push(`Pocket size: ${seedCav}`);
    if (widgetNotes) noteLines.push(widgetNotes);

    if (noteLines.length) {
      setNotes((prev) => {
        const existing = String(prev || "").trim();
        const merged = existing ? `${existing}\n\n${noteLines.join("\n")}` : noteLines.join("\n");
        return merged.trim();
      });
    }

    prefillAppliedRef.current = true;
  }, [searchParams]);

  const nameOk = name.trim().length > 0;
  const emailOk = email.trim().length > 0;
  const phoneOk = phone.trim().length > 0;

  const canOpenEditor = isWidgetPrefill || (nameOk && emailOk && phoneOk);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/materials/options?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as unknown;

        if (!Array.isArray(data)) return;

        const parsed: MaterialOption[] = data
          .map((x: any) => ({
            id: Number(x?.id),
            name: String(x?.name ?? ""),
            family: x?.family ?? null,
            density_lb_ft3: x?.density_lb_ft3 == null ? null : Number(x.density_lb_ft3),
          }))
          .filter((m) => Number.isFinite(m.id) && m.id > 0 && m.name);

        if (!cancelled) setMaterialOptions(parsed);
      } catch {
        // silent
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setLayerThicknesses((prev) => {
      const next = Array.from({ length: layerCount }, (_, i) => {
        const v = prev?.[i];
        return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1;
      });
      return next;
    });
  }, [layerCount]);

  React.useEffect(() => {
    setCavityLayerIndex((prev) => {
      const n = Number(prev);
      if (!Number.isFinite(n)) return 1;
      return Math.max(1, Math.min(layerCount, Math.floor(n)));
    });
  }, [layerCount]);

  const onOpenEditor = () => {
    setAttemptedOpen(true);
    if (!canOpenEditor) return;

    const quote_no = buildQuoteNo();

    const qtyNum = toNumOrNull(qty);
    const dims = normalizeDims(size);
    const firstCavity = extractFirstCavity(cavities);

    const p = new URLSearchParams();

    p.set("quote_no", quote_no);

    if (dims) p.set("dims", dims);
    if (qtyNum) p.set("qty", String(qtyNum));

    if (name.trim()) p.set("customer_name", name.trim());
    if (email.trim()) p.set("customer_email", email.trim());
    if (company.trim()) p.set("customer_company", company.trim());
    if (phone.trim()) p.set("customer_phone", phone.trim());

    const matIdNum = Number(materialId);
    if (Number.isFinite(matIdNum) && matIdNum > 0) {
      p.set("material_id", String(matIdNum));
      const picked = materialOptions.find((m) => m.id === matIdNum);
      if (picked?.name) p.set("material_label", picked.name);
    }

    p.set("layer_count", String(layerCount));
    for (const t of layerThicknesses) {
      p.append("layer_thicknesses", String(Number(t) || 1));
    }
    for (let i = 1; i <= layerCount; i++) {
      p.append("layer_label", `Layer ${i}`);
    }

    p.set("layer_cavity_layer_index", String(cavityLayerIndex));
    p.set("activeLayer", String(cavityLayerIndex));
    p.set("active_layer", String(cavityLayerIndex));
    if (firstCavity) p.set("cavity", firstCavity);

    if (shipMode) p.set("ship_mode", shipMode);
    if (insertType) p.set("insert_type", insertType);
    if (insertType === "set" && pocketsOn) p.set("pockets_on", pocketsOn);
    if (holding) p.set("holding", holding);
    if (holding === "pockets" && pocketCount) p.set("pocket_count", pocketCount);
    if (materialMode) p.set("material_mode", materialMode);
    if (materialText.trim()) p.set("material_text", materialText.trim());

    if (foam.trim()) p.set("foam", foam.trim());
    if (notes.trim()) p.set("notes", notes.trim());

    const url = `/quote/layout?${p.toString()}`;
    router.push(url);
  };

  const showNameErr = attemptedOpen && !isWidgetPrefill && !nameOk;
  const showEmailErr = attemptedOpen && !isWidgetPrefill && !emailOk;
  const showPhoneErr = attemptedOpen && !isWidgetPrefill && !phoneOk;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 opacity-[0.20]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 1px, transparent 1px, transparent 24px)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/10 via-slate-950/35 to-slate-950" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold tracking-widest text-sky-300/80">
              START A REAL QUOTE
            </div>
            <div className="mt-1 text-sm text-slate-300">
              Fill this in and we’ll jump straight into the{" "}
              <span className="text-slate-100 font-semibold">seeded editor</span>. (No email is
              sent from this page.)
            </div>

            {isWidgetPrefill ? (
              <div className="mt-2 text-xs text-slate-400">
                Detected <span className="text-slate-200">splash widget</span> prefill — contact
                fields are optional for the reveal flow.
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => router.push("/demo/quote")}
            className="inline-flex items-center justify-center rounded-full bg-white/5 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/10"
          >
            Back to demo
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="NAME">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="Chuck Johnson"
              />
              {showNameErr ? (
                <div className="mt-1 text-xs text-rose-300">Name is required.</div>
              ) : null}
            </Field>

            <Field label="COMPANY">
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="Acme Packaging"
              />
            </Field>

            <Field label="EMAIL">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="you@company.com"
              />
              {showEmailErr ? (
                <div className="mt-1 text-xs text-rose-300">Email is required.</div>
              ) : null}
            </Field>

            <Field label="PHONE">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="(555) 555-5555"
              />
              {showPhoneErr ? (
                <div className="mt-1 text-xs text-rose-300">Phone is required.</div>
              ) : null}
            </Field>

            <Field label="QUANTITY">
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="250"
              />
            </Field>

            <Field label="SHIPPING">
              <select
                value={shipMode}
                onChange={(e) => setShipMode(e.target.value as any)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                <option value="">Select…</option>
                <option value="mailer">Mailer</option>
                <option value="box">Box</option>
                <option value="unsure">Not sure</option>
              </select>
              <div className="mt-1 text-xs text-slate-400">
                Used for fit assumptions (we usually undersize L/W by 0.125&quot; for drop-in fit).
              </div>
            </Field>

            <Field label="INSERT TYPE">
              <select
                value={insertType}
                onChange={(e) => {
                  const v = e.target.value as any;
                  setInsertType(v);
                  if (v !== "set") setPocketsOn("");
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                <option value="">Select…</option>
                <option value="single">Single insert</option>
                <option value="set">Set (base + top pad/lid)</option>
                <option value="unsure">Not sure</option>
              </select>
            </Field>

            {insertType === "set" ? (
              <Field label="POCKETS ON (IF SET)">
                <select
                  value={pocketsOn}
                  onChange={(e) => setPocketsOn(e.target.value as any)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                >
                  <option value="">Select…</option>
                  <option value="base">Base</option>
                  <option value="top">Top</option>
                  <option value="both">Both</option>
                  <option value="unsure">Not sure</option>
                </select>
              </Field>
            ) : (
              <div />
            )}

            <Field label="HOLDING">
              <select
                value={holding}
                onChange={(e) => {
                  const v = e.target.value as any;
                  setHolding(v);
                  if (v !== "pockets") setPocketCount("");
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                <option value="">Select…</option>
                <option value="pockets">Cut-out pockets</option>
                <option value="loose">Loose / no pockets</option>
                <option value="unsure">Not sure</option>
              </select>
            </Field>

            {holding === "pockets" ? (
              <Field label="POCKET COUNT (IF POCKETS)">
                <select
                  value={pocketCount}
                  onChange={(e) => setPocketCount(e.target.value as any)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                >
                  <option value="">Select…</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3+">3+</option>
                  <option value="unsure">Not sure</option>
                </select>
              </Field>
            ) : (
              <div />
            )}

            <Field label="MATERIAL (PICK ONE)">
              <select
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                <option value="">
                  {materialOptions.length ? "Select material…" : "Loading materials…"}
                </option>
                {materialOptions.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name}
                    {m.family ? ` — ${m.family}` : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs text-slate-400">
                This avoids parsing/guessing. We seed{" "}
                <span className="text-slate-200">material_id</span> into the editor URL.
              </div>
            </Field>

            <Field label="MATERIAL MODE (FROM CHAT)">
              <select
                value={materialMode}
                onChange={(e) => setMaterialMode(e.target.value as any)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                <option value="">Select…</option>
                <option value="recommend">Recommend</option>
                <option value="known">Known</option>
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="MATERIAL TEXT (IF KNOWN)">
                <input
                  value={materialText}
                  onChange={(e) => setMaterialText(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder='Example: "EPE 1.7#"'
                />
              </Field>
            </div>

            <Field label="FOAM NOTES (OPTIONAL)">
              <input
                value={foam}
                onChange={(e) => setFoam(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="Any foam notes (optional)"
              />
            </Field>

            <Field label="LAYERS">
              <select
                value={String(layerCount)}
                onChange={(e) => setLayerCount(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                <option value="1">1 layer</option>
                <option value="2">2 layers</option>
                <option value="3">3 layers</option>
                <option value="4">4 layers</option>
              </select>
            </Field>

            <Field label="LAYER THICKNESSES (in)">
              <div className="flex gap-2">
                {Array.from({ length: layerCount }, (_, i) => (
                  <input
                    key={i}
                    value={String(layerThicknesses[i] ?? 1)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setLayerThicknesses((prev) => {
                        const next = [...prev];
                        next[i] = Number.isFinite(n) && n > 0 ? n : 1;
                        return next;
                      });
                    }}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                    placeholder="1"
                    inputMode="decimal"
                  />
                ))}
              </div>
            </Field>

            <Field label="CAVITY LAYER">
              <select
                value={String(cavityLayerIndex)}
                onChange={(e) => setCavityLayerIndex(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
              >
                {Array.from({ length: layerCount }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    Layer {i + 1}
                  </option>
                ))}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="OUTSIDE SIZE (L×W×H, inches — H = total stacked layer height)">
                <input
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder="18 × 12 × 2"
                />
              </Field>
              <div className="mt-1 text-xs text-slate-400">
                If this will go in a box/mailer, undersize the foam{" "}
                <span className="text-slate-200">Length</span> and{" "}
                <span className="text-slate-200">Width</span> by{" "}
                <span className="text-slate-200">0.125&quot;</span> for fit.
              </div>
            </div>

            <div className="sm:col-span-2">
              <Field label="CAVITIES / POCKETS">
                <input
                  value={cavities}
                  onChange={(e) => setCavities(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder="Example: 5x5x1 (or 2 cavities: 6x4x1.5, Ø3x1.5)"
                />
              </Field>
              <div className="mt-1 text-xs text-slate-400">
                Tip: For seeding, we’ll take the first “LxWxD” we can find (ex: 5x5x1). You can
                add/edit cavities in the editor.
                <span className="block mt-1">
                  Need cavities on other layers? Add them in the editor after you open it.
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <Field label="NOTES">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder="Any special fit, tolerances, assembly notes, carton constraints, etc."
                />
              </Field>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onOpenEditor}
              disabled={!canOpenEditor}
              className={[
                "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm ring-1",
                canOpenEditor
                  ? "bg-sky-500/90 ring-sky-300/20 hover:bg-sky-500"
                  : "bg-slate-700/40 ring-white/10 opacity-70 cursor-not-allowed",
              ].join(" ")}
              title={canOpenEditor || isWidgetPrefill ? "" : "Please fill in Name, Email, and Phone first."}
            >
              Editor — next step →
            </button>

            {!canOpenEditor && !isWidgetPrefill ? (
              <div className="text-xs text-slate-400">
                Required to open: <span className="text-slate-200">Name</span>,{" "}
                <span className="text-slate-200">Email</span>,{" "}
                <span className="text-slate-200">Phone</span>.
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-400">
            This page does not send email. After you finalize in the editor, use the normal “Apply to quote” flow.
          </div>
        </div>
      </div>
    </main>
  );
}
