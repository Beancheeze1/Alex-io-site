// app/start-quote/page.tsx
//
// Start Real Quote (lead capture + email builder)
// - No backend calls (Path A safe)
// - Generates an email body the user can copy or open via mailto:
//   sales@alex-io.com
//

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

function buildEmailBody(v: {
  name: string;
  company: string;
  email: string;
  phone: string;
  qty: string;
  foam: string;
  size: string;
  cavities: string;
  notes: string;
}) {
  const lines = [
    "Hi Alex-IO team,",
    "",
    "Please start a real quote with the following info:",
    "",
    `Name: ${v.name || "—"}`,
    `Company: ${v.company || "—"}`,
    `Email: ${v.email || "—"}`,
    `Phone: ${v.phone || "—"}`,
    "",
    "SPECS",
    `Quantity: ${v.qty || "—"}`,
    `Foam: ${v.foam || "—"} (family + density if known)`,
    `Outside size (L×W×H): ${v.size || "—"}`,
    `Cavities / pockets: ${v.cavities || "—"}`,
    "",
    "Notes",
    v.notes || "—",
    "",
    "Thanks!",
  ];
  return lines.join("\n");
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

  const subject = React.useMemo(() => {
    const c = company?.trim();
    return c ? `New Quote Request — ${c}` : "New Quote Request";
  }, [company]);

  const body = React.useMemo(
    () =>
      buildEmailBody({
        name,
        company,
        email,
        phone,
        qty,
        foam,
        size,
        cavities,
        notes,
      }),
    [name, company, email, phone, qty, foam, size, cavities, notes],
  );

  const mailtoHref = React.useMemo(() => {
    const to = "sales@alex-io.com";
    const s = encodeURIComponent(subject);
    const b = encodeURIComponent(body);
    return `mailto:${to}?subject=${s}&body=${b}`;
  }, [subject, body]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // no-op (clipboard may be blocked); user can still select manually
    }
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
              Fill this in and we’ll open a ready-to-send email to{" "}
              <span className="text-slate-100 font-semibold">sales@alex-io.com</span>.
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
                placeholder='EPE, 1.7 lb/ft³'
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label='OUTSIDE SIZE (L×W×H, inches)'>
                <input
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder='18 × 12 × 2'
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="CAVITIES / POCKETS">
                <input
                  value={cavities}
                  onChange={(e) => setCavities(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
                  placeholder='2 cavities: 6×4×1.5, Ø3×1.5'
                />
              </Field>
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
              onClick={onCopy}
              className="inline-flex items-center justify-center rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
            >
              Copy email text
            </button>

            <a
              href={mailtoHref}
              className="inline-flex items-center justify-center rounded-full bg-sky-500/90 px-5 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
            >
              Open email draft →
            </a>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-400">
            Tip: You can also email specs directly. This page just helps format the request cleanly.
          </div>
        </div>
      </div>
    </main>
  );
}
