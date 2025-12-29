// app/page.tsx
import type { ReactNode } from "react";
import Image from "next/image";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";

function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4">{children}</div>;
}

function Shot({
  src,
  alt,
  priority,
  aspect = "aspect-[16/10]",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  aspect?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />

      {/* Force consistent tile sizing + allow crop */}
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

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold tracking-widest text-sky-300/80">
      {children}
    </div>
  );
}

function MiniCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-300">{desc}</div>
    </div>
  );
}

function DividerBand() {
  return (
    <div className="relative my-10">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.55]">
        <div className="absolute left-1/2 top-1/2 h-[260px] w-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      </div>
      <div className="mx-auto h-px w-full max-w-5xl bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

function WorkflowStrip() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
      <div className="relative flex flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="text-xs font-semibold tracking-widest text-sky-300/80">
          WORKFLOW
        </div>
        <div className="text-sm font-semibold text-slate-100">
          Email → Quote → Layout → CAD
        </div>
        <div className="text-xs text-slate-400">
          One chain of custody from request → production files.
        </div>
      </div>
    </div>
  );
}

function EmailSnippetCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold tracking-widest text-sky-300/80">
          FIRST RESPONSE
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">
          auto-reply
        </span>
      </div>

      <div className="mt-3">
        <div className="text-sm font-semibold text-white">
          Subject: Foam quote {`{#}`}&nbsp;— specs + pricing + next steps
        </div>
        <div className="mt-2 text-sm leading-relaxed text-slate-300">
          We pulled the key specs from your email, priced the foam set, and
          generated an interactive quote. If anything looks off, reply with a
          correction and we’ll update it.
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-slate-100">
          Open quote
        </span>
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-slate-100">
          Edit layout
        </span>
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-slate-100">
          Export CAD
        </span>
      </div>
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

      {/* System-style header band (KEEP AS-IS) */}
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
              {/* Left: system identity */}
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

              {/* Right: status pill */}
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium text-sky-50">
                Automated first response
              </span>
            </div>
          </Container>
        </div>
      </header>

      {/* HERO */}
      <section className="relative z-10">
        <Container>
          <div className="pb-10 pt-8 sm:pb-12 sm:pt-10">
            <div className="mx-auto max-w-3xl text-center">
              <Kicker>EMAIL → QUOTE → LAYOUT → CAD</Kicker>

              {/* Keep your new hero copy, but make it visually “the headline” */}
              <p className="mt-3 text-base font-semibold leading-snug tracking-tight text-slate-100 sm:text-lg">
                Pricing, cavity layout, layered sets, and CAD-ready outputs—one
                connected workflow that starts with just a single email.
              </p>

              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Designed to feel like a real toolchain: clear, reviewable, and
                production-minded from the first reply.
              </p>
            </div>

            <div className="mt-7">
              <WorkflowStrip />
            </div>

            {/* Demo + Inline helper (compact, but more intentional) */}
            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <div id="demo" className="lg:col-span-7">
                <Shot
                  src="/splash/hero-quote.png"
                  alt="Alex-IO interactive quote summary"
                  priority
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-center text-xs text-slate-400">
                  Customer view: clear specs, pricing, and next step.
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
                  <div className="relative">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                        EXAMPLE INPUT
                      </div>
                      <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">
                        email-ready
                      </span>
                    </div>

                    {/* Render the helper inline (no forced max-width) */}
                    <QuoteHelperPanel className="mx-0 max-w-none" />

                    <div className="mt-3 text-[11px] leading-relaxed text-slate-400">
                      Tip: we typically undersize foam by ~0.125&quot; for an
                      easier fit into cartons and mailers.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature bullets (cleaner / less pill-y) */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MiniCard
                title="Automated first response"
                desc="Fast reply with specs + pricing, then link into the interactive quote."
              />
              <MiniCard
                title="Interactive layout editor"
                desc="Place cavities, build layers, and keep everything tied to the quote."
              />
              <MiniCard
                title="DXF/STEP exports"
                desc="Production-ready outputs per layer (previews + CAD)."
              />
            </div>

            <DividerBand />
          </div>
        </Container>
      </section>

      {/* PRODUCT OVERVIEW */}
      <section className="relative z-10">
        <Container>
          <div className="pb-12">
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

            {/* 2x2 grid, uniform tiles (cropped to consistent ratio) */}
            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <div>
                <Shot
                  src="/splash/layout-editor.png"
                  alt="Interactive foam layout editor"
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-xs text-slate-400">
                  Layout editor: layers + cavity tools + manufacturing intent.
                </div>
              </div>

              <div>
                <Shot
                  src="/splash/layer-previews.png"
                  alt="Per-layer layout previews"
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-xs text-slate-400">
                  Per-layer previews: communicate clearly before cutting.
                </div>
              </div>

              {/* Fill the “dead” feeling with a compact email-first card */}
              <div>
                <EmailSnippetCard />
                <div className="mt-2 text-xs text-slate-400">
                  Email-first flow: the system feels like a real inbox workflow.
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

              {/* Keep CAD output visible but prevent it from dominating */}
              <div className="lg:col-span-2">
                <div className="mt-1">
                  <Shot
                    src="/splash/cad-step.png"
                    alt="CAD STEP model output"
                    aspect="aspect-[21/9]"
                  />
                  <div className="mt-2 text-xs text-slate-400">
                    CAD output: DXF/STEP for engineering + vendors.
                  </div>
                </div>
              </div>
            </div>

            {/* CTA row */}
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
