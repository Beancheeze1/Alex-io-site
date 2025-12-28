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
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
      <Image
        src={src}
        alt={alt}
        width={1600}
        height={1000}
        className="h-auto w-full"
        priority={priority}
      />
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

function MiniCard({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-300">{desc}</div>
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

      {/* System-style header band (matches app vibe) */}
      <header className="relative z-10">
        <div className="border-b border-white/10 bg-gradient-to-b from-sky-600/30 via-sky-500/10 to-slate-950/40">
          <Container>
            <div className="flex items-center justify-between py-4">
              <div className="flex items-baseline gap-3">
                <div className="text-sm font-semibold tracking-tight text-white">
                  Alex-IO
                </div>
                <div className="hidden text-xs text-slate-300/80 sm:block">
                  quoting • layout • CAD
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="#demo"
                  className="rounded-full bg-white/5 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-white/10"
                >
                  Watch demo
                </a>
                <a
                  href="/quote"
                  className="rounded-full bg-sky-500/90 px-4 py-2 text-xs font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
                >
                  Open quote
                </a>
              </div>
            </div>
          </Container>
        </div>
      </header>

      {/* HERO (tight) */}
      <section className="relative z-10">
        <Container>
          <div className="pb-8 pt-8 sm:pb-10 sm:pt-10">
            <div className="mx-auto max-w-3xl text-center">
              <Kicker>EMAIL → QUOTE → LAYOUT → CAD</Kicker>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Turn an email into a finished foam package.
              </h1>

              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
                Pricing, cavity layout, layered sets, and CAD-ready outputs — one
                connected workflow that feels like real software.
              </p>
            </div>

            {/* Demo + Inline helper (compact) */}
            <div className="mt-7 grid gap-5 lg:grid-cols-12">
              <div id="demo" className="lg:col-span-7">
                <Shot
                  src="/splash/hero-quote.png"
                  alt="Alex-IO interactive quote summary"
                  priority
                />
                <div className="mt-2 text-center text-xs text-slate-400">
                  Customer view: clear specs, pricing, and next step.
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
                  <div className="relative">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                        EXAMPLE INPUT
                      </div>
                      <span className="text-[11px] text-slate-400">
                        copy/paste into an email
                      </span>
                    </div>

                    {/* Render the helper inline (no forced max-width) */}
                    <QuoteHelperPanel className="max-w-none mx-0" />
                  </div>
                </div>
              </div>
            </div>

            {/* Feature bullets (small, not scroll-heavy) */}
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
          </div>
        </Container>
      </section>

      {/* PRODUCT OVERVIEW (single compact grid section) */}
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

            {/* 2x2 grid, smaller tiles */}
            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <div>
                <Shot
                  src="/splash/layout-editor.png"
                  alt="Interactive foam layout editor"
                />
                <div className="mt-2 text-xs text-slate-400">
                  Layout editor: layers + cavity tools + manufacturing intent.
                </div>
              </div>

              <div>
                <Shot
                  src="/splash/layer-previews.png"
                  alt="Per-layer layout previews"
                />
                <div className="mt-2 text-xs text-slate-400">
                  Per-layer previews: communicate clearly before cutting.
                </div>
              </div>

              <div>
                <Shot src="/splash/cad-step.png" alt="CAD STEP model output" />
                <div className="mt-2 text-xs text-slate-400">
                  CAD output: DXF/STEP for engineering + vendors.
                </div>
              </div>

              <div>
                <Shot
                  src="/splash/admin-health.png"
                  alt="Admin health dashboard"
                />
                <div className="mt-2 text-xs text-slate-400">
                  Admin tools: materials, pricing, curves, integrations.
                </div>
              </div>
            </div>

            {/* CTA row (tight) */}
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
