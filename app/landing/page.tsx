"use client";
// app/landing/page.tsx
//
// Public Google Ads landing page.
//
// ALL "Try a Live Quote" / "Generate Sample Quote" CTAs now seed a real
// demo quote via POST /api/demo/seed and redirect to the layout editor.
// The layout editor, apply flow, and print view are 100% unmodified.
// Demo quotes are flagged is_demo=true in the DB for easy cleanup.
//
// Also includes the SplashChatWidget — when it collects enough info it
// calls seedDemoAndRedirect() instead of the normal /start-quote path.

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// ssr:false prevents localStorage crashing on the server during SSR.
const LandingChatWidget = dynamic(
  () => import("@/components/LandingChatWidget"),
  { ssr: false },
);

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

// Declare gtag for TypeScript — installed globally via layout.tsx
declare function gtag(...args: unknown[]): void;

/**
 * Fire a Google Ads conversion event.
 * Safe to call even if gtag hasn't loaded yet — it will no-op silently.
 */
function fireConversion(conversionLabel: string) {
  try {
    if (typeof gtag !== "undefined") {
      gtag("event", "conversion", {
        send_to: `AW-18060048309/${conversionLabel}`,
      });
    }
  } catch (e) {
    // Never block the user flow if tracking fails
    console.warn("[gtag] conversion fire failed:", e);
  }
}

function isPositive(raw: string) {
  const n = Number(String(raw || "").trim());
  return Number.isFinite(n) && n > 0;
}

/**
 * Central demo seeding function used by BOTH the form and the chat widget.
 * Posts to /api/demo/seed and navigates to the returned redirectPath.
 * Returns false if it fails (caller shows an error).
 */
async function seedDemoAndRedirect(
  router: ReturnType<typeof useRouter>,
  payload: {
    outsideL: string | number;
    outsideW: string | number;
    outsideH: string | number;
    qty: string | number;
    customerName?: string;
    customerEmail?: string;
    company?: string;
    shipMode?: string;
    insertType?: string;
    layerCount?: string;
    layerThicknesses?: string[];
    holding?: string;
    pocketCount?: string;
    materialMode?: string;
    materialText?: string;
    materialId?: number | null;
    cavities?: string;
    notes?: string;
    packagingSku?: string;
    packagingChoice?: string | null;
    printed?: boolean | null;
    source?: string;
  },
): Promise<boolean> {
  try {
    const res = await fetch("/api/demo/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({ ok: false }));

    if (!data?.ok || !data?.redirectPath) {
      console.error("[landing] demo/seed failed:", data);
      return false;
    }

    router.push(data.redirectPath);
    return true;
  } catch (err) {
    console.error("[landing] demo/seed error:", err);
    return false;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-200">
        {label}
        {required ? <span className="text-sky-300"> *</span> : null}
      </div>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 transition focus:border-sky-400/60 focus:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-200">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none ring-0 transition focus:border-sky-400/60 focus:bg-white/[0.06] disabled:opacity-50"
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

function MiniCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-300">{body}</div>
    </div>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "Do I need to know how to code to set this up?",
    a: "No. Alex-IO is a hosted platform. You configure your materials, pricing, and branding through an admin dashboard — no development required.",
  },
  {
    q: "How long does it take to get up and running?",
    a: "Most shops are generating live quotes within a day. You set your material costs and pricing rules, and the system handles the rest.",
  },
  {
    q: "Can I use my own pricing and materials?",
    a: "Yes. Alex-IO is built around your shop's actual foam types, densities, and cost structure — not generic placeholder pricing.",
  },
  {
    q: "What does my customer actually see?",
    a: "They get a guided quote flow that collects their dimensions and requirements, then drops directly into a layout editor with live pricing. They can see a printable quote summary without ever talking to a salesperson.",
  },
  {
    q: "Is this only for foam inserts?",
    a: "Currently yes — Alex-IO is purpose-built for custom foam insert quoting. That focus is what makes the pricing and layout output accurate, where generic CPQ tools fall short.",
  },
  {
    q: "What's included in the $599/month plan?",
    a: "The Starter plan includes your full quoting workflow, customer-facing quote widget, layout editor, printable quote output, and admin dashboard. Higher tiers unlock CAD exports, multiple seats, and multi-location support.",
  },
  {
    q: "Do I have to sign a long-term contract?",
    a: "No. Plans are month-to-month. Cancel anytime.",
  },
  {
    q: "How is this different from a generic CPQ tool like Salesforce or Conga?",
    a: "Those tools are built for selling software licenses and services — not for quoting physical foam parts with cavity layouts and material density pricing. Alex-IO understands the geometry of what you're making, not just the line items.",
  },
];

function FaqSection() {
  const [open, setOpen] = React.useState<number | null>(null);

  return (
    <section className="relative z-10">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
          Common questions
        </div>
        <h2 className="mb-8 text-2xl font-bold text-white">
          Everything you need to know
        </h2>
        <div className="mx-auto max-w-3xl divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/[0.03] overflow-hidden">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-5 text-left text-sm font-semibold text-white hover:bg-white/[0.03] transition"
              >
                <span>{item.q}</span>
                <span className="ml-4 shrink-0 text-sky-400 text-lg leading-none">
                  {open === i ? "−" : "+"}
                </span>
              </button>
              {open === i && (
                <div className="px-6 pb-5 text-sm leading-7 text-slate-300">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

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
  const [seedError, setSeedError] = React.useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSeedError(false);
    setSubmitting(true);

    // Step 1: Create the demo quote in DB and get back a Q-DEMO- quote number
    let quoteNo: string;
    try {
      const res = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outsideL: form.outsideL.trim(),
          outsideW: form.outsideW.trim(),
          outsideH: form.outsideH.trim(),
          qty: form.qty.trim(),
          customerName: form.customerName.trim(),
          customerEmail: form.customerEmail.trim(),
          company: form.company.trim(),
          shipMode: form.shipMode,
          insertType: form.insertType,
          layerCount: form.insertType === "set" ? "2" : "1",
          holding: "pockets",
          pocketCount: "1",
          materialMode: "recommend",
          notes: form.notes.trim(),
          source: "landing-form",
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data?.ok || !data?.quoteNo) {
        setSeedError(true);
        setSubmitting(false);
        return;
      }
      quoteNo = data.quoteNo;
    } catch {
      setSeedError(true);
      setSubmitting(false);
      return;
    }

    // Fire Google Ads conversion — "Demo Quote Started"
    // Replace XXXXXXXXXX below with your conversion label from Google Ads
    fireConversion("XXXXXXXXXX");

    // Step 2: Build a prefill payload with the real Q-DEMO- quote number baked in.
    const prefill = {
      quoteNo,
      source: "landing-demo",
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
      material: { mode: "recommend", text: "", id: null },
      packagingSku: "",
      packagingChoice: null,
      printed: false,
      layerCount: form.insertType === "set" ? "2" : "1",
      layerThicknesses: [],
      cavities: "",
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      company: form.company.trim(),
      notes: form.notes.trim(),
    };

    router.push(`/start-quote?prefill=${encodeURIComponent(JSON.stringify(prefill))}&demo=1`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      {/* Background grid */}
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

      {/* Nav */}
      <section className="relative z-10 border-b border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.20),rgba(15,23,42,0.20)_45%,rgba(2,6,23,0.60)_100%)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-200/80">
              Alex-IO
            </div>
            <div className="text-sm text-slate-300">Quoting · Layout · CAD</div>
          </div>
          <a
            href="#sample-quote"
            className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs sm:px-4 sm:text-sm font-medium text-sky-100 transition hover:bg-sky-400/15 whitespace-nowrap"
          >
            <span className="hidden sm:inline">Try a Live </span>Quote
          </a>
        </div>
      </section>

      {/* Hero */}
      <section className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-6">
              {/* EDIT 1 & 2: Eyebrow text updated */}
              <div className="text-xs font-semibold uppercase tracking-[0.20em] text-sky-300/80">
                Quoting Software for Foam Fabricators
              </div>

              {/* EDIT 3: Hero headline updated */}
              <h1 className="mt-4 max-w-3xl text-3xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
                Stop quoting foam by hand.
              </h1>

              {/* EDIT 4: Hero subheadline updated */}
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Alex-IO is quoting software built specifically for foam fabricators and packaging shops. Real material pricing, layered cavity layouts, and printable customer-ready quotes — generated in minutes, not days.
              </p>

              {/* EDIT 6: Feature grid copy updated */}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  "Customer-facing quote flow embedded in your site",
                  "Accurate pricing based on your real material and density costs",
                  "Layered foam insert layouts with production-ready outputs",
                  "Your customer answers questions — not a blank form",
                ].map((t) => (
                  <div
                    key={t}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200"
                  >
                    {t}
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#sample-quote"
                  className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
                >
                  Try a Live Quote
                </a>
                <a
                  href="#proof"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
                >
                  See the live workflow
                </a>
              </div>

              {/* EDIT 5: Price anchor updated */}
              <div className="mt-8 text-sm text-slate-400">
                Starts at{" "}
                <span className="font-semibold text-slate-200">$599/month</span>.{" "}
                No long-term contract.
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative mx-auto max-w-2xl">
                <Shot src="/splash/hero-quote.png" alt="Alex-IO quote summary" priority />

                <div className="absolute -right-2 top-6 hidden w-[52%] rotate-[1.5deg] lg:block">
                  <Shot src="/splash/layout-editor.png" alt="Alex-IO layout editor" />
                </div>

                <div className="absolute -left-2 bottom-[-26px] hidden w-[48%] -rotate-[1.5deg] lg:block">
                  <Shot src="/splash/layer-previews.png" alt="Alex-IO layer previews" />
                </div>

                <div className="pointer-events-none mt-8 h-12 lg:h-24" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quote form */}
      <section id="sample-quote" className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 pb-8 sm:pb-12">
          <div className="grid gap-8 lg:grid-cols-12">
            {/* Left: explainer — hidden on mobile to surface the form immediately */}
            <div className="lg:col-span-5 hidden lg:block">
              <div className="rounded-3xl border border-sky-400/20 bg-sky-400/[0.05] p-6">
                {/* EDIT 7: Demo section label updated */}
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
                  See It Live — No Signup Required
                </div>
                <h2 className="mt-3 text-2xl font-bold text-white">
                  Run a real customer quote — live
                </h2>
                {/* EDIT 8: Added "exact flow" line */}
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This is the exact flow your customers would see on your site. Enter your dimensions and we'll drop you straight into the layout editor with real pricing. No sign-up. No sales call.
                </p>

                <div className="mt-6 space-y-3">
                  <MiniCard
                    title="1. Enter your specs"
                    body="Outside dimensions, quantity, and a contact email."
                  />
                  <MiniCard
                    title="2. Open the layout editor"
                    body="Design cavities, set layers, and see the foam set take shape."
                  />
                  <MiniCard
                    title="3. Apply and print"
                    body="Hit Apply and get a full printable quote with live pricing."
                  />
                </div>
              </div>
            </div>

            {/* Right: form */}
            <div className="lg:col-span-7">
              {/* Mobile-only heading */}
              <div className="lg:hidden mb-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
                  See It Live — No Signup Required
                </div>
                <h2 className="mt-2 text-xl font-bold text-white">
                  Run the full quote flow — live
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  This is the exact flow your customers would see on your site. Enter your specs and go straight into the layout editor with real pricing.
                </p>
              </div>
              <form
                onSubmit={handleSubmit}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
              >
                <div className="mb-5 rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] px-4 py-3 text-sm leading-6 text-slate-300">
                  This is the real Alex-IO quote flow. The quote generated from this form
                  mirrors what your customer would experience on your site.
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field
                    label="Name"
                    value={form.customerName}
                    onChange={(v) => set("customerName", v)}
                    placeholder="Your name"
                    disabled={submitting}
                  />
                  <Field
                    label="Email"
                    value={form.customerEmail}
                    onChange={(v) => set("customerEmail", v)}
                    placeholder="you@company.com"
                    required
                    type="email"
                    disabled={submitting}
                  />
                  <Field
                    label="Company"
                    value={form.company}
                    onChange={(v) => set("company", v)}
                    placeholder="Your company"
                    disabled={submitting}
                  />
                  <Field
                    label="Quantity"
                    value={form.qty}
                    onChange={(v) => set("qty", v)}
                    placeholder="100"
                    inputMode="numeric"
                    required
                    disabled={submitting}
                  />
                  <Field
                    label="Insert length (in)"
                    value={form.outsideL}
                    onChange={(v) => set("outsideL", v)}
                    placeholder="12"
                    inputMode="decimal"
                    required
                    disabled={submitting}
                  />
                  <Field
                    label="Insert width (in)"
                    value={form.outsideW}
                    onChange={(v) => set("outsideW", v)}
                    placeholder="8"
                    inputMode="decimal"
                    required
                    disabled={submitting}
                  />
                  <Field
                    label="Insert depth (in)"
                    value={form.outsideH}
                    onChange={(v) => set("outsideH", v)}
                    placeholder="3"
                    inputMode="decimal"
                    required
                    disabled={submitting}
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
                    disabled={submitting}
                  />
                  <SelectField
                    label="Insert build"
                    value={form.insertType}
                    onChange={(v) => set("insertType", v as InsertType)}
                    options={[
                      { value: "single", label: "Single insert" },
                      { value: "set", label: "Set: base + top pad" },
                    ]}
                    disabled={submitting}
                  />
                </div>

                <div className="mt-5">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-slate-200">Notes</div>
                    <textarea
                      value={form.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="Anything important about the part, fit, or packaging?"
                      rows={3}
                      disabled={submitting}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 transition focus:border-sky-400/60 focus:bg-white/[0.06] disabled:opacity-50"
                    />
                  </label>
                </div>

                {seedError && (
                  <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                    Something went wrong seeding your demo. Please try again in a moment.
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-6 text-slate-400">
                    Required: dimensions, quantity, and a valid email. Built for packaging teams and foam fabricators.
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "Opening live quote…" : "Get Instant Quote →"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Proof section */}
      <section id="proof" className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
          <div className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
            What your team and customers see
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <MiniCard
              title="Layout editor"
              body="Design cavity profiles, set layer thicknesses, and see the foam set rendered in real time."
            />
            <MiniCard
              title="Live pricing"
              body="Every change in the editor reprices automatically. No hidden steps, no waiting."
            />
            <MiniCard
              title="Printable quote"
              body="One click to a clean, customer-ready quote summary with full line items, totals, and a clear next step."
            />
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <Shot src="/splash/layout-editor.png" alt="Alex-IO layout editor screenshot" />
            <Shot src="/splash/admin-health.png" alt="Alex-IO admin and workflow screenshot" />
          </div>
        </div>
      </section>

      {/* EDIT 10: FAQ section — added above final CTA */}
      <FaqSection />

      {/* EDIT 9: Final CTA section updated */}
      <section className="relative z-10 border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
              Ready to see it in action?
            </div>
            <h2 className="mt-3 text-3xl font-bold text-white">
              See a real foam quote generated in under 2 minutes.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Enter your dimensions and go straight into the layout editor. No fake
              handoff, no canned output. The pricing is live and the workflow is the
              same one your customer would follow.
            </p>
            <div className="mt-6">
              <a
                href="#sample-quote"
                className="inline-flex rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              >
                Try a Live Quote
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Chat widget — seeded facts go through demo flow, not /start-quote */}
      <LandingChatWidget />
    </main>
  );
}