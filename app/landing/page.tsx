"use client";
// app/landing/page.tsx
//
// Public Google Ads landing page.
//
// ALL "Try a Live Quote" CTAs seed a real demo quote via POST /api/demo/seed
// and redirect to the layout editor. Demo quotes are flagged is_demo=true.
//
// Form is intentionally minimal: L × W × D + Qty only.
// No name/email/company required — contact info collected post-conversion.
// StartQuoteModal steps are pre-filled from prefill params so user just clicks Next.

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const LandingChatWidget = dynamic(
  () => import("@/components/LandingChatWidget"),
  { ssr: false },
);

// ── Types ─────────────────────────────────────────────────────────────────────

type FormState = {
  outsideL: string;
  outsideW: string;
  outsideH: string;
  qty: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

declare function gtag(...args: unknown[]): void;

function fireConversion() {
  try {
    if (typeof gtag !== "undefined") {
      // Conversion label from Google Ads → Tools → Conversions → "Demo Quote Started"
      gtag("event", "conversion", {
        send_to: "AW-18060048309/8Pa3CJbBmJ0cELXv2aND",
      });
    }
  } catch (e) {
    console.warn("[gtag] conversion fire failed:", e);
  }
}

function isPositive(raw: string) {
  const n = Number(String(raw || "").trim());
  return Number.isFinite(n) && n > 0;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DimField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-200">{label}</div>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 transition focus:border-sky-400/60 focus:bg-white/[0.06] disabled:opacity-50"
      />
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
    q: "What's included in the $799/month plan?",
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


// ── Capabilities ──────────────────────────────────────────────────────────────

function CapabilityCard({
  icon,
  title,
  body,
  accent = false,
}: {
  icon: string;
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-3 ${
      accent
        ? "border-sky-400/25 bg-sky-400/[0.05]"
        : "border-white/10 bg-white/[0.03]"
    }`}>
      <div className="text-2xl leading-none">{icon}</div>
      <div className="text-sm font-semibold text-white leading-snug">{title}</div>
      <div className="text-sm leading-relaxed text-slate-400">{body}</div>
    </div>
  );
}

function CapabilitiesSection() {
  return (
    <section className="relative z-10">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">

        {/* Section header */}
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
          Everything Alex-IO does
        </div>
        <h2 className="mb-3 text-2xl font-bold text-white sm:text-3xl">
          This isn't just a quoting form.
        </h2>
        <p className="mb-10 max-w-2xl text-sm leading-7 text-slate-300">
          Alex-IO is a full quoting and estimating platform built specifically for foam fabricators.
          From the moment an RFQ hits your inbox to the moment a production-ready CAD file leaves your shop — it's handled.
        </p>

        {/* ── Row 1: Getting the quote in ──────────────────────────────────── */}
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Getting the RFQ in
        </div>
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CapabilityCard
            icon="📧"
            accent
            title="Email RFQ parsing"
            body="Forward or paste a customer email and Alex-IO extracts dimensions, quantity, cavity count, and material spec — then opens a live, priced quote. No re-keying."
          />
          <CapabilityCard
            icon="🖼️"
            accent
            title="Sketch & drawing upload"
            body="Upload a hand sketch, napkin drawing, or PDF spec sheet. The AI reads the geometry and populates the quote. Your customer doesn't need to know what polyethylene is."
          />
          <CapabilityCard
            icon="💬"
            accent
            title="AI chat widget"
            body="Embed a chat widget on your website. Customers describe what they need in plain language — 'a 12×8 case insert for a rifle scope' — and get a priced quote without calling anyone."
          />
          <CapabilityCard
            icon="📋"
            accent
            title="Guided quote form"
            body="A structured step-by-step form for customers who prefer to enter specs directly. Ship mode, insert type, cavity count, material preference — it walks them through everything."
          />
        </div>

        {/* ── Row 2: Building the quote ────────────────────────────────────── */}
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Building the quote
        </div>
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CapabilityCard
            icon="🧩"
            title="Layered cavity layout editor"
            body="Design multi-layer foam sets with individual cavity profiles per layer. Rectangles, circles, custom shapes. The layout renders in real time as you build it."
          />
          <CapabilityCard
            icon="⚡"
            title="Live pricing engine"
            body="Every change in the editor — layer count, cavity size, material, quantity — reprices instantly against your actual material costs and density-based markups. No formulas to maintain."
          />
          <CapabilityCard
            icon="🧠"
            title="AI material recommendation"
            body="Enter the product weight, drop height, and fragility rating. Alex-IO recommends the right foam type and density for the application — not just the cheapest option."
          />
          <CapabilityCard
            icon="📐"
            title="Cushion curve analysis"
            body="Engineering-grade G-factor cushion curve calculations for customers who spec fragility limits. Tells you exactly which foam provides the right shock attenuation for their product."
          />
        </div>

        {/* ── Row 3: Getting the quote out ─────────────────────────────────── */}
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Getting the quote out
        </div>
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CapabilityCard
            icon="🖨️"
            title="Branded customer quote PDF"
            body="One click generates a clean, customer-ready quote with your branding, full line items, layer breakdown, cavity counts, material specs, and a clear next step."
          />
          <CapabilityCard
            icon="📐"
            title="3-view technical drawing PDF"
            body="A dimensioned top/front/side engineering drawing — the kind your shop floor or production team expects. Generated from the same layout, no separate drafting required."
          />
          <CapabilityCard
            icon="⚙️"
            title="DXF / STEP CAD exports"
            body="Production-ready CAD files come straight out of the quote. Hand them to your CNC operator or send them to the customer without any re-drawing in a separate tool."
          />
          <CapabilityCard
            icon="📦"
            title="Box & carton pairing"
            body="Alex-IO suggests the right corrugated shipping carton to pair with the foam insert, factoring in wall clearance and insert thickness. Quote the full package in one step."
          />
        </div>

        {/* ── Row 4: Running your shop ─────────────────────────────────────── */}
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Running your shop
        </div>
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CapabilityCard
            icon="📊"
            title="Commission tracking"
            body="Set commission percentages per sales rep. Alex-IO tracks which quotes each rep owns, calculates commissions on locked quotes, and generates payout reports. No spreadsheets."
          />
          <CapabilityCard
            icon="🔗"
            title="HubSpot CRM sync"
            body="Quotes sync to HubSpot automatically as deals. Contacts are matched or created. Your CRM stays current without anyone manually updating it after every customer conversation."
          />
          <CapabilityCard
            icon="✉️"
            title="Send quotes from Outlook"
            body="Send branded quote emails directly through your existing Microsoft 365 / Outlook account. Quotes land in the customer's inbox from your address, not a generic noreply."
          />
          <CapabilityCard
            icon="🔒"
            title="Quote locking & revision history"
            body="Lock quotes for production so nothing changes accidentally. Need to revise a locked quote? Full revision history tracks every version. Nothing gets lost."
          />
          <CapabilityCard
            icon="📚"
            title="Price book management"
            body="Import and manage your full material catalog — foam types, densities, costs, markups. Update once and every future quote reflects the change automatically."
          />
          <CapabilityCard
            icon="👥"
            title="Multi-rep, multi-seat"
            body="Multiple salespeople, individual quote ownership, role-based access. Admins see everything. Reps see their own queue. Everyone works from the same system."
          />
        </div>

        {/* ── Bottom wow-moment callout ─────────────────────────────────────── */}
        <div className="rounded-3xl border border-sky-400/20 bg-gradient-to-br from-sky-400/[0.07] via-transparent to-cyan-400/[0.04] p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80 mb-2">
                The bottom line
              </div>
              <h3 className="text-xl font-bold text-white sm:text-2xl leading-snug">
                A customer emails you at 9pm.<br />
                They have a quote in their inbox by 9:05.
              </h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                That's not a future state — that's Alex-IO today. The email arrives,
                the AI parses it, a cavity layout is built, your pricing runs against
                it, and a branded PDF is generated. Your team wakes up to a done deal,
                not a pile of RFQs to work through.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-3">
              {[
                "No more quoting from memory",
                "No more spreadsheet pricing",
                "No more re-keying RFQ emails",
                "No more chasing CAD files",
                "No more manual commission math",
              ].map((t) => (
                <div key={t} className="flex items-center gap-3 text-sm text-slate-300">
                  <span className="shrink-0 text-sky-400">✓</span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

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
        <div className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/[0.03] overflow-hidden">
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
    outsideL: "",
    outsideW: "",
    outsideH: "",
    qty: "",
  });

  const [submitting, setSubmitting] = React.useState(false);
  const [seedError, setSeedError] = React.useState(false);

  const dimsOk =
    isPositive(form.outsideL) &&
    isPositive(form.outsideW) &&
    isPositive(form.outsideH);

  const qtyOk = isPositive(form.qty);
  const canSubmit = dimsOk && qtyOk && !submitting;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSeedError(false);
    setSubmitting(true);

    let quoteNo: string;
    let seedMaterialId: number | null = null;
    let seedMaterialName: string = "";
    try {
      const res = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outsideL: form.outsideL.trim(),
          outsideW: form.outsideW.trim(),
          outsideH: form.outsideH.trim(),
          qty: form.qty.trim(),
          shipMode: "box",
          insertType: "single",
          layerCount: "1",
          holding: "pockets",
          pocketCount: "1",
          materialMode: "recommend",
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
      seedMaterialId = typeof data.materialId === "number" ? data.materialId : null;
      seedMaterialName = typeof data.materialName === "string" ? data.materialName : "";
    } catch {
      setSeedError(true);
      setSubmitting(false);
      return;
    }

    // Fire Google Ads conversion
    fireConversion();

    // Build prefill — dims + material pre-populated so StartQuoteModal steps are ready to click Next
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
      shipMode: "box",
      insertType: "single",
      pocketsOn: "",
      holding: "pockets",
      pocketCount: "1",
      material: {
        mode: seedMaterialId ? "known" : "recommend",
        text: seedMaterialName,
        id: seedMaterialId,
      },
      packagingSku: "",
      packagingChoice: null,
      printed: false,
      layerCount: "1",
      layerThicknesses: [],
      cavities: "",
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
              <div className="text-xs font-semibold uppercase tracking-[0.20em] text-sky-300/80">
                Quoting Software for Foam Fabricators
              </div>
              <h1 className="mt-4 max-w-3xl text-3xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
                Stop quoting foam by hand.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Alex-IO is quoting software built specifically for foam fabricators and packaging shops. Real material pricing, layered cavity layouts, and printable customer-ready quotes — generated in minutes, not days.
              </p>
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

              {/* Single CTA */}
              <div className="mt-8">
                <a
                  href="#sample-quote"
                  className="inline-flex rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
                >
                  Try a Live Quote
                </a>
              </div>

              <div className="mt-6 text-sm text-slate-400">
                Starts at{" "}
                <span className="font-semibold text-slate-200">$799/month</span>.{" "}
                No long-term contract.{" "}
                <a href="#pricing" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">
                  90-day pilot at $399/mo →
                </a>
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

      {/* Quote form — minimal: L × W × D + Qty only */}
      <section id="sample-quote" className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 pb-8 sm:pb-12">
          <div className="grid gap-8 lg:grid-cols-12">
            {/* Left: explainer */}
            <div className="lg:col-span-5 hidden lg:block">
              <div className="rounded-3xl border border-sky-400/20 bg-sky-400/[0.05] p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
                  See It Live — No Signup Required
                </div>
                <h2 className="mt-3 text-2xl font-bold text-white">
                  Run a real customer quote — live
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This is the exact flow your customers would see on your site. Enter your dimensions and we'll drop you straight into the layout editor with real pricing. No sign-up. No sales call.
                </p>
                <div className="mt-6 space-y-3">
                  <MiniCard
                    title="1. Enter your dimensions"
                    body="Outside insert size and quantity. That's all we need to start."
                  />
                  <MiniCard
                    title="2. Open the layout editor"
                    body="Design cavities, set layers, and see the foam set take shape with live pricing."
                  />
                  <MiniCard
                    title="3. Apply and print"
                    body="Hit Apply and get a full printable quote with real line items and totals."
                  />
                </div>
              </div>
            </div>

            {/* Right: minimal form */}
            <div className="lg:col-span-7">
              <div className="lg:hidden mb-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
                  See It Live — No Signup Required
                </div>
                <h2 className="mt-2 text-xl font-bold text-white">
                  Run the full quote flow — live
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Enter your insert dimensions and go straight into the layout editor with real pricing.
                </p>
              </div>

              {/* Glow wrapper */}
              <div className="relative">
                {/* Outer glow layers */}
                <div className="pointer-events-none absolute -inset-[3px] rounded-[28px] bg-gradient-to-br from-sky-400/40 via-cyan-400/25 to-sky-500/40 blur-[2px]" />
                <div className="pointer-events-none absolute -inset-[8px] rounded-[32px] bg-sky-400/10 blur-[12px]" />
                <div className="pointer-events-none absolute -inset-[16px] rounded-[40px] bg-sky-500/8 blur-[28px]" />

              <form
                onSubmit={handleSubmit}
                className="relative rounded-3xl border border-sky-400/40 bg-[rgba(2,12,30,0.85)] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(148,220,255,0.08)]"
              >
                <div className="mb-5 rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] px-4 py-3 text-sm leading-6 text-slate-300">
                  Enter your insert dimensions and quantity — we'll open the live editor with real pricing. No account needed.
                </div>

                {/* 3 dim fields + qty in a tight 2-col grid */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <DimField
                    label="Insert length (in)"
                    value={form.outsideL}
                    onChange={(v) => set("outsideL", v)}
                    placeholder="12"
                    disabled={submitting}
                  />
                  <DimField
                    label="Insert width (in)"
                    value={form.outsideW}
                    onChange={(v) => set("outsideW", v)}
                    placeholder="8"
                    disabled={submitting}
                  />
                  <DimField
                    label="Insert depth (in)"
                    value={form.outsideH}
                    onChange={(v) => set("outsideH", v)}
                    placeholder="3"
                    disabled={submitting}
                  />
                  <DimField
                    label="Quantity"
                    value={form.qty}
                    onChange={(v) => set("qty", v)}
                    placeholder="100"
                    disabled={submitting}
                  />
                </div>

                {seedError && (
                  <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                    Something went wrong starting the demo. Please try again.
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-6 text-slate-400">
                    No account. No sales call. Add contact info inside the editor if you want to save your quote.
                  </div>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="rounded-xl bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                  >
                    {submitting ? "Opening live quote…" : "Get Instant Quote →"}
                  </button>
                </div>
              </form>
              </div>{/* end glow wrapper */}
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <CapabilitiesSection />

      {/* Pilot offer + Pricing */}
      <section id="pricing" className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">

          {/* Pilot callout banner */}
          <div className="mb-10 rounded-3xl border border-amber-400/30 bg-amber-400/[0.06] p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300/80">
                  Limited Time · New Customers Only
                </div>
                <h2 className="mt-2 text-xl font-bold text-white">
                  90-Day Pilot Program — $399/month
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  Full access to everything in the Starter plan. No contract — cancel anytime during the pilot.
                  At day 91, your account automatically continues at standard Starter pricing ($799/mo) unless you cancel.
                  Credit card required to start.
                </p>
                <ul className="mt-3 space-y-1 text-sm text-slate-300">
                  <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> Full quoting workflow, layout editor, printable quotes</li>
                  <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> Customer-facing quote widget for your website</li>
                  <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> Admin dashboard and material/pricing configuration</li>
                  <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> 2 user seats included</li>
                </ul>
              </div>
              <div className="shrink-0 text-center">
                <div className="text-4xl font-extrabold text-white">$399</div>
                <div className="text-sm text-slate-400">/ month for 90 days</div>
                <a
                  href="mailto:chuck@alex-io.com?subject=90-Day Pilot — Alex-IO&body=Hi Chuck, I'd like to get started with the 90-day pilot program."
                  className="mt-4 inline-flex rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
                >
                  Start Pilot →
                </a>
                <div className="mt-2 text-xs text-slate-500">or email chuck@alex-io.com</div>
              </div>
            </div>
          </div>

          {/* Pricing tiers */}
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
            Pricing
          </div>
          <h2 className="mb-8 text-2xl font-bold text-white">Simple, transparent plans</h2>
          <div className="grid gap-6 lg:grid-cols-3">

            {/* Starter */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 flex flex-col">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300/80">Starter</div>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-white">$799</span>
                <span className="mb-1 text-sm text-slate-400">/ month</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">2 seats · month-to-month</div>
              <ul className="mt-5 space-y-2 text-sm text-slate-300 flex-1">
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Full quoting workflow</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Customer-facing quote widget</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Layout editor with live pricing</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Printable customer-ready quotes</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Admin dashboard</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Email RFQ parsing</li>
              </ul>
              <a
                href="mailto:chuck@alex-io.com?subject=Alex-IO Starter Plan"
                className="mt-6 inline-flex justify-center rounded-xl border border-sky-400/30 bg-sky-400/10 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20"
              >
                Get Started
              </a>
            </div>

            {/* Pro */}
            <div className="rounded-3xl border border-sky-400/30 bg-sky-400/[0.05] p-6 flex flex-col relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-sky-400 px-3 py-0.5 text-xs font-semibold text-slate-950">
                Most Popular
              </div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300/80">Pro</div>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-white">$1,299</span>
                <span className="mb-1 text-sm text-slate-400">/ month</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">10 seats · month-to-month</div>
              <ul className="mt-5 space-y-2 text-sm text-slate-300 flex-1">
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Everything in Starter</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>CAD exports (DXF / STEP)</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>HubSpot CRM sync</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Commission tracking</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>10 user seats</li>
              </ul>
              <a
                href="mailto:chuck@alex-io.com?subject=Alex-IO Pro Plan"
                className="mt-6 inline-flex justify-center rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              >
                Get Started
              </a>
            </div>

            {/* Shop */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 flex flex-col">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300/80">Shop</div>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-white">$1,999</span>
                <span className="mb-1 text-sm text-slate-400">/ month</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">Unlimited seats · month-to-month</div>
              <ul className="mt-5 space-y-2 text-sm text-slate-300 flex-1">
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Everything in Pro</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Unlimited user seats</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>White-label / custom branding</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>Multi-location support</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-sky-400">✓</span>API access</li>
              </ul>
              <a
                href="mailto:chuck@alex-io.com?subject=Alex-IO Shop Plan"
                className="mt-6 inline-flex justify-center rounded-xl border border-sky-400/30 bg-sky-400/10 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20"
              >
                Get Started
              </a>
            </div>

          </div>
        </div>
      </section>

      {/* FAQ — moved up, before screenshots */}
      <FaqSection />

      {/* Proof / screenshots */}
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

      {/* Final CTA */}
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

      <LandingChatWidget />
    </main>
  );
}