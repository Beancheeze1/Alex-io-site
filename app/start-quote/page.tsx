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
import { useRouter } from "next/navigation";

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
  // Format matches your existing examples: Q-AI-YYYYMMDD-HHMMSS
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
  // Accept: "18 x 12 x 3", "18×12×3", "18*12*3", "18,12,3", etc.
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[×\*]/g, "x")
    .replace(/,/g, "x")
    .replace(/\s+/g, "");

  // Keep only digits, dot, and 'x'
  const cleaned = s.replace(/[^0-9.x]/g, "");

  // Reduce multiple x’s / weird formats to 3 parts when possible
  const parts = cleaned.split("x").filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]}x${parts[1]}x${parts[2]}`;
  }
  return cleaned; // best effort
}

function extractFirstCavity(cavitiesText: string) {
  // Very simple: find first pattern like "5x5x1" or "Ø3x1.5" (we’ll normalize circle to "3x3x1.5" is NOT desired)
  // For now: only support rect-style "LxWxD" as a single cavity seed.
  // If not found, return null and user can add in editor.
  const s = String(cavitiesText || "")
    .replace(/[×\*]/g, "x")
    .replace(/\s+/g, "");

  const m = s.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return `${m[1]}x${m[2]}x${m[3]}`;
}

export default function StartQuotePage() {
  const router = useRouter();

  const [name, setName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [foam, setFoam] = React.useState("");
  const [size, setSize] = React.useState("");
  const [cavities, setCavities] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // --- layers ---
  const [layerCount, setLayerCount] = React.useState<number>(3);
  const [layerThicknesses, setLayerThicknesses] = React.useState<number[]>([
    1, 1, 1,
  ]);

  // NEW: explicit cavity layer (1-based)
  // Default to Layer 2 (common case) but clamp if layerCount changes.
  const [cavityLayerIndex, setCavityLayerIndex] = React.useState<number>(2);

  // Keep thickness array length aligned to layerCount (Path-A safe)
  React.useEffect(() => {
    setLayerThicknesses((prev) => {
      const next = Array.from({ length: layerCount }, (_, i) => {
        const v = prev?.[i];
        return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1;
      });
      return next;
    });
  }, [layerCount]);

  // Keep cavity layer in range when layerCount changes
  React.useEffect(() => {
    setCavityLayerIndex((prev) => {
      const n = Number(prev);
      if (!Number.isFinite(n)) return 1;
      return Math.max(1, Math.min(layerCount, Math.floor(n)));
    });
  }, [layerCount]);

  const onOpenEditor = () => {
    const quote_no = buildQuoteNo();

    const qtyNum = toNumOrNull(qty);
    const dims = normalizeDims(size);
    const firstCavity = extractFirstCavity(cavities);

    const p = new URLSearchParams();

    // Required-ish
    p.set("quote_no", quote_no);

    if (dims) p.set("dims", dims);
    if (qtyNum) p.set("qty", String(qtyNum));

    // Customer
    if (name.trim()) p.set("customer_name", name.trim());
    if (email.trim()) p.set("customer_email", email.trim());
    if (company.trim()) p.set("customer_company", company.trim());
    if (phone.trim()) p.set("customer_phone", phone.trim());

    // Layers
    p.set("layer_count", String(layerCount));
    for (const t of layerThicknesses) {
      p.append("layer_thicknesses", String(Number(t) || 1));
    }
    for (let i = 1; i <= layerCount; i++) {
      p.append("layer_label", `Layer ${i}`);
    }

    // Cavity seeding (single cavity best-effort)
    // IMPORTANT: this index must match the user’s intent, otherwise the cavity “lands” on the wrong layer.
    p.set("layer_cavity_layer_index", String(cavityLayerIndex));

    // Land the user on the intended layer on first open (keep both keys for compatibility)
    p.set("activeLayer", String(cavityLayerIndex));
    p.set("active_layer", String(cavityLayerIndex));

    if (firstCavity) p.set("cavity", firstCavity);

    // Optional (editor may ignore; safe to pass)
    if (foam.trim()) p.set("foam", foam.trim());
    if (notes.trim()) p.set("notes", notes.trim());

    const url = `/quote/layout?${p.toString()}`;
    router.push(url);
  };

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
              <span className="text-slate-100 font-semibold">seeded editor</span>.
              (No email is sent from this page.)
            </div>
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
            </Field>

            <Field label="PHONE">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="(555) 555-5555"
              />
            </Field>

            <Field label="QUANTITY">
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="250"
              />
            </Field>

            <Field label="FOAM (FAMILY + DENSITY)">
              <input
                value={foam}
                onChange={(e) => setFoam(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                placeholder="EPE, 1.7 lb/ft³"
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

            {/* NEW: explicit cavity layer selector */}
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
              <Field label="OUTSIDE SIZE (L×W×H, inches)">
                <input
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder="18 × 12 × 2"
                />
              </Field>
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
                Tip: For seeding, we’ll take the first “LxWxD” we can find (ex:
                5x5x1). You can add/edit cavities in the editor.
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
              className="inline-flex items-center justify-center rounded-full bg-sky-500/90 px-5 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
            >
              Open seeded editor →
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-400">
            This page does not send email. After you finalize in the editor, use
            the normal “Apply to quote” flow.
          </div>
        </div>
      </div>
    </main>
  );
}
