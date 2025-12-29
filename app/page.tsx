// app/page.tsx
import type { ReactNode } from "react";
import Image from "next/image";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";

function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4">{children}</div>;
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold tracking-widest text-sky-300/80">
      {children}
    </div>
  );
}

function MiniCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-300">{desc}</div>
    </div>
  );
}

function Shot({
  src,
  alt,
  priority,
  aspect = "aspect-[16/10]",
  className = "",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  aspect?: string;
  className?: string;
}) {
  return (
    <div
      className={[
        "group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]",
        className,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />

      <div className={`${aspect} w-full overflow-hidden`}>
        <Image
          src={src}
          alt={alt}
          width={1600}
          height={1000}
          className="h-full w-full object-cover"
          priority={priority}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute inset-0 bg-white/[0.03]" />
      </div>
    </div>
  );
}

function EmailSampleInline() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold tracking-widest text-sky-300/80">
          FIRST RESPONSE (SAMPLE)
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">
          auto-reply
        </span>
      </div>

      <div className="mt-3 text-sm">
        <div className="font-semibold text-white">
          Subject: Foam quote {`{#}`} — specs + pricing + next steps
        </div>
        <div className="mt-2 leading-relaxed text-slate-300">
          We pulled the key specs from your email, priced the foam set, and
          generated an interactive quote. If anything looks off, reply with a
          correction and we’ll update it.
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-200">
            Open quote
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-200">
            Edit layout
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-200">
            Export CAD
          </div>
        </div>
      </div>
    </div>
  );
}

function OverlapSnips() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="pointer-events-none absolute -inset-6 rounded-[28px] bg-sky-500/10 blur-2xl" />

      <div className="relative">
        <Shot
          src="/splash/hero-quote.png"
          alt="Alex-IO interactive quote summary"
          priority
          aspect="aspect-[16/10]"
        />
      </div>

      <div className="absolute -right-3 top-7 w-[62%] rotate-[1.5deg] sm:-right-6 sm:top-8 sm:w-[58%]">
        <Shot
          src="/splash/admin-health.png"
          alt="Admin health dashboard"
          aspect="aspect-[16/10]"
          className="shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_70px_rgba(0,0,0,0.65)]"
        />
      </div>

      <div className="absolute -left-3 bottom-7 w-[58%] -rotate-[1.25deg] sm:-left-6 sm:bottom-8 sm:w-[55%]">
        <Shot
          src="/splash/layer-previews.png"
          alt="Per-layer layout previews"
          aspect="aspect-[16/10]"
          className="shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_70px_rgba(0,0,0,0.65)]"
        />
      </div>

      <div className="pointer-events-none mt-5 h-20 sm:h-24" />
    </div>
  );
}

function SpecChip({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <span className="h-1.5 w-1.5 rounded-full bg-sky-400/90" />
      <div className="text-[12px] text-slate-200">{children}</div>
    </div>
  );
}

function WhatToIncludeCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-widest text-sky-300/80">
          WHAT TO INCLUDE
        </div>
        <span className="text-[11px] text-slate-400">minimal back-and-forth</span>
      </div>

      <div className="mt-3 text-sm leading-relaxed text-slate-300">
        Send a normal RFQ email. If you include these items, Alex-IO can price
        and build the layout cleanly on the first pass.
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <SpecChip>Outside size (L×W×H, inches)</SpecChip>
        <SpecChip>Quantity to quote</SpecChip>
        <SpecChip>Foam family (PE / EPE / PU)</SpecChip>
        <SpecChip>Density (e.g., 1.7 lb)</SpecChip>
        <SpecChip>Number of cavities / pockets</SpecChip>
        <SpecChip>Cavity sizes (L×W×Depth or Ø×Depth)</SpecChip>
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer list-none rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[12px] font-semibold text-slate-100 hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <span>Show copy/paste example</span>
            <span className="text-slate-400 group-open:hidden">+</span>
            <span className="text-slate-400 hidden group-open:inline">−</span>
          </div>
        </summary>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
          <QuoteHelperPanel className="max-w-none mx-0" />
        </div>

        <div className="mt-2 text-[11px] text-slate-400">
          Tip: if fit is tight, mention clearance requirements so the foam is
          sized appropriately.
        </div>
      </details>
    </div>
  );
}

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      {/* Editor-style grid background */}
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

      {/* System-style header band (KEEP SAME COLOR SCHEME) */}
      <header className="relative z-10">
        <div
          className="border-b border-white/10"
          style={{
            background:
              "linear-gradient(135deg, rgba(14,165,233,0.9) 0%, rgba(14,165,233,0.9) 45%, rgba(15,23,42,1) 100%)",
          }}
        >
          <Container>
            <div className="flex items-center justify-between py-4">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-sky-100/90">
                  Powered by
                </div>
                <div className="text-lg font-extrabold text-sky-50 drop-shadow-[0_0_8px_rgba(15,23,42,0.55)]">
                  Alex-IO
                </div>
                <div className="mt-0.5 text-xs text-sky-100/90">
                  Quoting · Layout · CAD
                </div>
              </div>

              {/* UPDATED PILL LABEL */}
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium text-sky-50">
                Automated Quoting Assistant
              </span>
            </div>
          </Container>
        </div>
      </header>

      {/* HERO */}
      <section className="relative z-10">
        <Container>
          <div className="pb-10 pt-7 sm:pb-12 sm:pt-9">
            <div className="grid items-start gap-7 lg:grid-cols-12">
              {/* Left */}
              <div className="lg:col-span-6">
                <Kicker>EMAIL → QUOTE → LAYOUT → CAD</Kicker>

                <p className="mt-2.5 text-base leading-relaxed text-slate-300 sm:text-lg">
                  Pricing, cavity layout, layered sets, and CAD-ready outputs—one
                  connected workflow that starts with just a single email.
                </p>

                <div className="mt-4 grid gap-2.5">
                  <div className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-sky-400/90" />
                    <div className="text-sm leading-relaxed text-slate-300">
                      Start with a normal RFQ email.
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-sky-400/90" />
                    <div className="text-sm leading-relaxed text-slate-300">
                      Get an automated response with specs, pricing, and a live
                      quote link.
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-sky-400/90" />
                    <div className="text-sm leading-relaxed text-slate-300">
                      Design the layout: layers, cavities, previews — all tied to
                      the quote.
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-sky-400/90" />
                    <div className="text-sm leading-relaxed text-slate-300">
                      Export per-layer DXF/STEP for engineering and vendors.
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/quote"
                    className="inline-flex items-center justify-center rounded-full bg-sky-500/90 px-6 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
                  >
                    Try the interactive quote
                  </a>
                  <a
                    href="mailto:sales@alex-io.com"
                    className="inline-flex items-center justify-center rounded-full bg-white/10 px-6 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                  >
                    Contact sales
                  </a>
                </div>

                <div className="mt-5">
                  <EmailSampleInline />
                </div>
              </div>

              {/* Right */}
              <div className="lg:col-span-6">
                <OverlapSnips />
                <div className="mt-2 text-center text-xs text-slate-400">
                  One flow across customer view, previews, and admin visibility.
                </div>
              </div>
            </div>

            {/* Option B: “What to include” replaces screenshot wall */}
            <div className="mt-9 grid gap-5 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <WhatToIncludeCard />
              </div>

              <div className="lg:col-span-5">
                <div className="grid gap-3">
                  <MiniCard
                    title="Email-first workflow"
                    desc="Starts in the inbox, then jumps straight into a real quote and layout—no back-and-forth chaos."
                  />
                  <MiniCard
                    title="Manufacturing intent built-in"
                    desc="Layers, cavity geometry, and previews are first-class—designed for how foam actually gets cut."
                  />
                  <MiniCard
                    title="Per-layer CAD outputs"
                    desc="DXF/STEP exports per layer so engineering and vendors get exactly what they need."
                  />
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* SYSTEM SECTION */}
      <section className="relative z-10">
        <Container>
          <div className="pb-10">
            <div className="mx-auto max-w-4xl text-center">
              <Kicker>THE SYSTEM</Kicker>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Everything stays connected.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
                Quotes, layouts, previews, CAD, and admin visibility — designed
                to feel like one unified toolchain.
              </p>
            </div>

            {/* Your current layout (CAD/admin + wide editor) stays as-is below */}
            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <div>
                <Shot
                  src="/splash/cad-step.png"
                  alt="CAD STEP model output"
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-xs text-slate-400">
                  CAD output: DXF/STEP for engineering + vendors.
                </div>
              </div>

              <div>
                <Shot
                  src="/splash/admin-health.png"
                  alt="Admin health dashboard"
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-xs text-slate-400">
                  Admin tools: materials, pricing, curves, integrations.
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Shot
                src="/splash/layout-editor.png"
                alt="Interactive foam layout editor"
                aspect="aspect-[21/9]"
                className="shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_70px_rgba(0,0,0,0.65)]"
              />
              <div className="mt-2 text-xs text-slate-400">
                Layout editor: layers · cavity tools · manufacturing intent.
              </div>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/quote"
                className="rounded-full bg-sky-500/90 px-6 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
              >
                Try the interactive quote
              </a>
              <a
                href="mailto:sales@alex-io.com"
                className="rounded-full bg-white/10 px-6 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
              >
                Contact sales
              </a>
            </div>

            <div className="mt-10 text-center text-xs text-slate-500">
              © {new Date().getFullYear()} Alex-IO. All rights reserved.
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
