// app/page.tsx
import Image from "next/image";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4">{children}</div>;
}

function SectionTitle({
  kicker,
  title,
  desc,
}: {
  kicker?: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {kicker ? (
        <div className="text-xs font-semibold tracking-widest text-sky-300/80">
          {kicker}
        </div>
      ) : null}
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {desc ? (
        <p className="mt-3 text-base leading-relaxed text-slate-300">{desc}</p>
      ) : null}
    </div>
  );
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
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_80px_rgba(0,0,0,0.55)]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
      <Image
        src={src}
        alt={alt}
        width={1800}
        height={1200}
        className="h-auto w-full"
        priority={priority}
      />
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10">
      {children}
    </span>
  );
}

function LogoMark() {
  // Text-based mark (no asset dependency). If you later add a real SVG, we can swap it.
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
        <div className="absolute inset-0 bg-gradient-to-b from-sky-400/30 via-sky-500/10 to-transparent" />
        <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/10 blur-xl" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-white">
          Alex-IO
        </div>
        <div className="text-[11px] text-slate-300/80">
          quoting • layout • CAD
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      {/* Editor-style grid background */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.22]">
        {/* fine grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) 1px, transparent 1px, transparent 24px)",
          }}
        />
        {/* subtle vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-slate-950/40 to-slate-950" />
      </div>

      {/* Top blue gradient band */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-[320px] bg-gradient-to-b from-sky-600/25 via-sky-500/10 to-transparent" />

      {/* Header */}
      <header className="relative z-10">
        <Container>
          <div className="flex items-center justify-between py-6">
            <LogoMark />

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

          <div className="border-t border-white/5" />
        </Container>
      </header>

      {/* HERO */}
      <section className="relative z-10">
        <Container>
          <div className="flex flex-col items-center justify-center pb-10 pt-10 sm:pt-14">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Turn an email into a finished foam package.
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-300">
                Pricing, cavity layout, layered sets, and CAD-ready outputs — tied
                together in one workflow.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <Pill>Automated first response</Pill>
                <Pill>Interactive layout editor</Pill>
                <Pill>Per-layer previews</Pill>
                <Pill>DXF/STEP exports</Pill>
                <Pill>Foam advisor</Pill>
                <Pill>Admin tools</Pill>
              </div>
            </div>

            {/* HERO SHOT + helper, in a tighter two-column layout on large screens */}
            <div className="mt-10 grid w-full gap-6 lg:grid-cols-12">
              <div id="demo" className="lg:col-span-7">
                <Shot
                  src="/splash/hero-quote.png"
                  alt="Alex-IO interactive quote summary"
                  priority
                />
                <p className="mt-3 text-center text-xs text-slate-400">
                  A clean customer view with clear specs, pricing, and next step.
                </p>
              </div>

              <div className="lg:col-span-5">
                {/* Vibe wrapper for QuoteHelperPanel (without editing the component) */}
                <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_80px_rgba(0,0,0,0.55)]">
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
                  <div className="relative">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                        TRY IT
                      </div>
                      <span className="text-xs text-slate-400">
                        (copy/paste into an email)
                      </span>
                    </div>
                    <QuoteHelperPanel />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* SECTION: Layout editor */}
      <section className="relative z-10">
        <Container>
          <div className="py-14">
            <SectionTitle
              kicker="THE WOW FACTOR"
              title="Design the foam visually"
              desc="Place cavities, align, nudge, duplicate, and build layered foam sets — all tied to the live quote."
            />

            <div className="mt-10 grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <Shot
                  src="/splash/layout-editor.png"
                  alt="Interactive foam layout editor"
                />
              </div>
              <div className="lg:col-span-4 space-y-6">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="text-sm font-semibold text-white">
                    Layer-aware
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    Per-layer thickness, cavities, and optional crop treatment
                    (e.g., top pad finger relief).
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="text-sm font-semibold text-white">
                    Fast placement
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    Snap + grid, plus tools to center, align to walls, and refine
                    quickly.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="text-sm font-semibold text-white">
                    Manufacturing-first
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    The layout becomes the source of truth for previews and CAD
                    exports.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* SECTION: Layer previews + CAD (compact two-up) */}
      <section className="relative z-10">
        <Container>
          <div className="py-14">
            <SectionTitle
              kicker="PRODUCTION OUTPUT"
              title="From quote → layout → CAD-ready"
              desc="Previews communicate intent clearly, while exports give engineering exactly what they need."
            />

            <div className="mt-10 grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <Shot
                  src="/splash/layer-previews.png"
                  alt="Per-layer layout previews"
                />
              </div>
              <div className="lg:col-span-5">
                <Shot src="/splash/cad-step.png" alt="CAD STEP model output" />
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* SECTION: Foam Advisor + Admin (side-by-side to shorten page) */}
      <section className="relative z-10">
        <Container>
          <div className="py-14">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
              <div>
                <SectionTitle
                  kicker="ENGINEERING INTELLIGENCE"
                  title="Foam Advisor (cushion curves)"
                  desc="Translate weight + contact area into operating load, then pick a foam family grounded in curve data."
                />
                <div className="mt-10">
                  <Shot
                    src="/splash/foam-advisor.png"
                    alt="Foam recommendation assistant"
                  />
                </div>
              </div>

              <div>
                <SectionTitle
                  kicker="OPS + TRUST"
                  title="Built for real operations"
                  desc="Admin tools keep pricing, materials, curves, and integrations observable — so quotes stay consistent."
                />
                <div className="mt-10">
                  <Shot
                    src="/splash/admin-health.png"
                    alt="Admin health dashboard"
                  />
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
              </div>
            </div>

            <div className="mt-14 pb-10 text-center text-xs text-slate-500">
              © {new Date().getFullYear()} Alex-IO. All rights reserved.
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
