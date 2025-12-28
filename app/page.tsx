// app/page.tsx
import Image from "next/image";
import BrandCard from "@/components/BrandCard";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4">
      {children}
    </div>
  );
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
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          {desc}
        </p>
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

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-950 text-slate-50">
      {/* Top glow */}
      <div className="pointer-events-none absolute left-1/2 top-[-200px] h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />

      {/* HERO */}
      <Container>
        <div className="flex min-h-[92vh] flex-col items-center justify-center py-14">
          <BrandCard />

          <div className="mt-6 max-w-3xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Quoting + foam layout, automated end-to-end.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-300">
              Alex-IO turns an inbound email into a priced quote, an interactive layout editor,
              and CAD-ready exports — with admin tools to keep everything grounded in real data.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Pill>Automated first response</Pill>
              <Pill>Interactive layout editor</Pill>
              <Pill>Per-layer previews & exports</Pill>
              <Pill>Foam advisor (cushion curves)</Pill>
              <Pill>Admin health & pricing tools</Pill>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#demo"
                className="rounded-full bg-sky-500/90 px-6 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
              >
                Watch demo
              </a>
              <a
                href="/quote"
                className="rounded-full bg-white/10 px-6 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
              >
                Open interactive quote
              </a>
            </div>
          </div>

          <div id="demo" className="mt-10 w-full">
            <Shot
              src="/splash/hero-quote.png"
              alt="Alex-IO interactive quote summary"
              priority
            />
            <p className="mt-3 text-center text-xs text-slate-400">
              The customer sees a clean quote with clear specs, pricing, and the next step: open the layout editor.
            </p>
          </div>

          {/* Keep your helper panel (nice “try it” feel) */}
          <div className="mt-10 w-full">
            <QuoteHelperPanel />
          </div>
        </div>
      </Container>

      {/* SECTION: Layout editor */}
      <Container>
        <div className="py-16">
          <SectionTitle
            kicker="THE WOW FACTOR"
            title="Design the foam visually"
            desc="Place cavities, align, nudge, duplicate, and build layered foam sets — all tied to the live quote."
          />
          <div className="mt-10">
            <Shot src="/splash/layout-editor.png" alt="Interactive foam layout editor" />
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="text-sm font-semibold text-white">Layer-aware</div>
              <div className="mt-2 text-sm text-slate-300">
                Per-layer thickness, cavities, and optional crop treatment (e.g., top pad finger relief).
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="text-sm font-semibold text-white">Fast placement</div>
              <div className="mt-2 text-sm text-slate-300">
                Snap + grid, plus tools to center, align to walls, and quickly refine a layout.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="text-sm font-semibold text-white">Manufacturing-first</div>
              <div className="mt-2 text-sm text-slate-300">
                The layout is the source of truth for previews and CAD exports.
              </div>
            </div>
          </div>
        </div>
      </Container>

      {/* SECTION: Layer previews + CAD */}
      <Container>
        <div className="py-16">
          <SectionTitle
            kicker="PRODUCTION OUTPUT"
            title="From quote → layout → CAD-ready"
            desc="Layer previews communicate intent clearly, while exports give engineering exactly what they need."
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <Shot src="/splash/layer-previews.png" alt="Per-layer layout previews" />
            </div>
            <div className="lg:col-span-5">
              <Shot src="/splash/cad-step.png" alt="CAD STEP model output" />
            </div>
          </div>
        </div>
      </Container>

      {/* SECTION: Foam Advisor */}
      <Container>
        <div className="py-16">
          <SectionTitle
            kicker="ENGINEERING INTELLIGENCE"
            title="Foam Advisor powered by cushion curves"
            desc="Translate weight + contact area into operating load, and get foam-family recommendations grounded in curve data."
          />
          <div className="mt-10">
            <Shot src="/splash/foam-advisor.png" alt="Foam recommendation assistant" />
          </div>
        </div>
      </Container>

      {/* SECTION: Admin trust */}
      <Container>
        <div className="py-16">
          <SectionTitle
            kicker="OPS + TRUST"
            title="Built for real operations"
            desc="Admin tools keep pricing, materials, curves, and integrations observable — so quotes stay consistent and supportable."
          />
          <div className="mt-10">
            <Shot src="/splash/admin-health.png" alt="Admin health dashboard" />
          </div>

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

          <div className="mt-10 pb-10 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} Alex-IO. All rights reserved.
          </div>
        </div>
      </Container>
    </main>
  );
}
