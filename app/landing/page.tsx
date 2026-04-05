"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type ShipMode = "box" | "mailer" | "unsure";
type InsertType = "single" | "set";

type FormState = {
  customerName: string;
  customerEmail: string;
  company: string;
  outsideL: string;
  outsideW: string;
  outsideH: string;
  qty: string;
  shipMode: ShipMode;
  insertType: InsertType;
  notes: string;
};

function isPositive(raw: string) {
  const n = Number(String(raw || "").trim());
  return Number.isFinite(n) && n > 0;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-200">
        {label}
        {required ? <span className="text-sky-300"> *</span> : null}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 transition focus:border-sky-400/60 focus:bg-white/[0.06]"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-200">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none ring-0 transition focus:border-sky-400/60 focus:bg-white/[0.06]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-slate-950 text-white">
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Shot({
  src,
  alt,
  priority = false,
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_60px_rgba(0,0,0,0.45)]">
      <Image
        src={src}
        alt={alt}
        width={1600}
        height={1000}
        priority={priority}
        className="h-auto w-full object-cover"
      />
    </div>
  );
}

function MiniCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-300">{body}</div>
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();

  const [form, setForm] = React.useState<FormState>({
    customerName: "",
    customerEmail: "",
    company: "",
    outsideL: "",
    outsideW: "",
    outsideH: "",
    qty: "",
    shipMode: "box",
    insertType: "single",
    notes: "",
  });

  const [submitting, setSubmitting] = React.useState(false);

  const dimsOk =
    isPositive(form.outsideL) &&
    isPositive(form.outsideW) &&
    isPositive(form.outsideH);

  const qtyOk = isPositive(form.qty);
  const emailOk =
    form.customerEmail.trim().length > 3 &&
    /\S+@\S+\.\S+/.test(form.customerEmail.trim());

  const canSubmit = dimsOk && qtyOk && emailOk && !submitting;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);

    const payload = {
      source: "google-ads-landing",
      createdAtIso: new Date().toISOString(),
      outside: {
        l: form.outsideL.trim(),
        w: form.outsideW.trim(),
        h: form.outsideH.trim(),
        units: "in",
      },
      qty: form.qty.trim(),
      shipMode: form.shipMode,
      insertType: form.insertType,
      pocketsOn: form.insertType === "set" ? "base" : "",
      holding: "pockets",
      pocketCount: "1",
      material: {
        mode: "recommend",
        text: "",
        id: null,
      },
      packagingSku: "",
      packagingChoice: null,
      printed: false,
      layerCount: form.insertType === "set" ? "2" : "1",
      layerThicknesses: [],
      cavities: "",
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      notes: form.notes.trim(),
      company: form.company.trim(),
    };

    const prefill = encodeURIComponent(JSON.stringify(payload));
    router.push(`/start-quote?prefill=${prefill}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 opacity-[0.16]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 1px, transparent 1px, transparent 24px)",
          }}
        />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-[-220px] h-[460px] w-[860px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-120px] top-[420px] h-[380px] w-[380px] rounded-full bg-cyan-400/10 blur-3xl" />

      <section className="relative z-10 border-b border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.20),rgba(15,23,42,0.20)_45%,rgba(2,6,23,0.60)_100%)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-200/80">
              Alex-IO
            </div>
            <div className="text-sm text-slate-300">
              Quoting · Layout · CAD
            </div>
          </div>
          <a
            href="#sample-quote"
            className="rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-400/15"
          >
            Get a Sample Quote
          </a>
        </div>
      </section>

      <section className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-6">
              <div className="text-xs font-semibold uppercase tracking-[0.20em] text-sky-300/80">
                Built for real packaging workflows
              </div>

              <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight text-white sm:text-5xl">
                Generate foam packaging quotes without the usual back-and-forth.
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Alex-IO combines layout, material selection, and pricing into one guided
                workflow. Cold traffic should not have to figure your system out. This
                page gets them into a real quote session fast.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  Import-ready workflow for drawings and layouts
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  Real material and density selection
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  Layered inserts and production-ready outputs
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  Guided quote flow instead of a blank tool
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#sample-quote"
                  className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
                >
                  Get a Sample Quote
                </a>
                <a
                  href="#proof"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
                >
                  See the workflow
                </a>
              </div>

              <div className="mt-8 text-sm text-slate-400">
                Starts around <span className="font-semibold text-slate-200">$799/month</span> for small teams.
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative mx-auto max-w-2xl">
                <Shot
                  src="/splash/hero-quote.png"
                  alt="Alex-IO quote summary"
                  priority
                />

                <div className="absolute -right-2 top-6 hidden w-[52%] rotate-[1.5deg] lg:block">
                  <Shot
                    src="/splash/layout-editor.png"
                    alt="Alex-IO layout editor"
                  />
                </div>

                <div className="absolute -left-2 bottom-[-26px] hidden w-[48%] -rotate-[1.5deg] lg:block">
                  <Shot
                    src="/splash/layer-previews.png"
                    alt="Alex-IO layer previews"
                  />
                </div>

                <div className="pointer-events-none mt-8 h-12 lg:h-24" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="sample-quote" className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 pb-8 sm:pb-12">
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="rounded-3xl border border-sky-400/20 bg-sky-400/[0.05] p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
                  Guided entry
                </div>
                <h2 className="mt-3 text-2xl font-bold text-white">
                  Start a real quote session
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This does not dump the visitor into a dead-end form. It seeds your
                  existing quote flow with real inputs and sends them straight into the
                  guided start process.
                </p>

                <div className="mt-6 space-y-3">
                  <MiniCard
                    title="1. Enter the basics"
                    body="Size, quantity, shipping style, and contact info."
                  />
                  <MiniCard
                    title="2. Launch the quote flow"
                    body="The form preloads your existing /start-quote workflow."
                  />
                  <MiniCard
                    title="3. Continue into layout and pricing"
                    body="The visitor lands inside the real Alex-IO quote path."
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <form
                onSubmit={handleSubmit}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field
                    label="Name"
                    value={form.customerName}
                    onChange={(v) => set("customerName", v)}
                    placeholder="Chuck Johnson"
                  />
                  <Field
                    label="Email"
                    value={form.customerEmail}
                    onChange={(v) => set("customerEmail", v)}
                    placeholder="you@company.com"
                    required
                    type="email"
                  />
                  <Field
                    label="Company"
                    value={form.company}
                    onChange={(v) => set("company", v)}
                    placeholder="Your company"
                  />
                  <Field
                    label="Quantity"
                    value={form.qty}
                    onChange={(v) => set("qty", v)}
                    placeholder="100"
                    required
                  />
                  <Field
                    label='Package / insert length (in)'
                    value={form.outsideL}
                    onChange={(v) => set("outsideL", v)}
                    placeholder='12'
                    required
                  />
                  <Field
                    label='Package / insert width (in)'
                    value={form.outsideW}
                    onChange={(v) => set("outsideW", v)}
                    placeholder='8'
                    required
                  />
                  <Field
                    label='Package / insert depth (in)'
                    value={form.outsideH}
                    onChange={(v) => set("outsideH", v)}
                    placeholder='3'
                    required
                  />
                  <SelectField
                    label="Shipping style"
                    value={form.shipMode}
                    onChange={(v) => set("shipMode", v as ShipMode)}
                    options={[
                      { value: "box", label: "Box" },
                      { value: "mailer", label: "Mailer" },
                      { value: "unsure", label: "Insert only / not sure yet" },
                    ]}
                  />
                  <SelectField
                    label="Insert build"
                    value={form.insertType}
                    onChange={(v) => set("insertType", v as InsertType)}
                    options={[
                      { value: "single", label: "Single insert" },
                      { value: "set", label: "Set: base + top pad" },
                    ]}
                  />
                </div>

                <div className="mt-5">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-slate-200">
                      Notes
                    </div>
                    <textarea
                      value={form.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="Anything important about the part, fit, or packaging?"
                      rows={4}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 transition focus:border-sky-400/60 focus:bg-white/[0.06]"
                    />
                  </label>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-6 text-slate-400">
                    Required for launch: dimensions, quantity, and a valid email.
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "Launching..." : "Generate Sample Quote"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      <section id="proof" className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
          <div className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
            Why this page fits your codebase
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <MiniCard
              title="Uses your existing quote start flow"
              body="No new pricing logic. No new layout engine. No regression risk in the core quote path."
            />
            <MiniCard
              title="Matches the actual product"
              body="The screenshots and copy line up with the UI and workflow you already shipped."
            />
            <MiniCard
              title="Better for paid traffic"
              body="Ad visitors get a clear entry point instead of having to decode the app on their own."
            />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Shot
              src="/splash/layout-editor.png"
              alt="Alex-IO layout editor screenshot"
            />
            <Shot
              src="/splash/admin-health.png"
              alt="Alex-IO admin and workflow screenshot"
            />
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
              Final CTA
            </div>
            <h2 className="mt-3 text-3xl font-bold text-white">
              Stop making paid traffic work that hard.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              This route gives Google Ads visitors a clear path into Alex-IO without
              touching your existing quote, layout, or pricing internals.
            </p>
            <div className="mt-6">
              <a
                href="#sample-quote"
                className="inline-flex rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              >
                Get a Sample Quote
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}