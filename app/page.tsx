// app/page.tsx
import Image from "next/image";
import BrandCard from "@/components/BrandCard";
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
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {title}
      </h2>
      {desc ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
          {desc}
        </p>
      ) : null}
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

function Shot({
  src,
  alt,
  caption,
  priority,
  aspectClass = "aspect-[16/10]",
}: {
  src: string;
  alt: string;
  caption?: string;
  priority?: boolean;
  aspectClass?: string;
}) {
  return (
    <div className="group">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_70px_rgba(0,0,0,0.55)]">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />
        <div className={`relative ${aspectClass}`}>
          <Image
            src={src}
            alt={alt}
            fill
            priority={priority}
            sizes="(max-width: 1024px) 100vw, 520px"
            className="object-cover object-top"
          />
        </div>
      </div>

      {caption ? (
        <p className="mt-2 text-center text-xs text-slate-400">{caption}</p>
      ) : null}
    </div>
  );
}

function FeatureCard({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm text-slate-300">{desc}</div>
    </div>
  );
}

export default function Page() {
  return (
    <main className="relative min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-950 text-slate-50">
      {/* Top glow */}
      <div className="pointer-events-none absolute left-1/2 top-[-220px] h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />

      <Container>
        {/* HERO (shorter than before) */}
        <div className="pt-12 pb-10 sm:pt-16 sm:pb-12">
          <div className="flex flex-col items-center justify-center">
            <BrandCard />

            <div className="mt-6 max-w-3xl text-center">
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Quoting + foam layout, automated end-to-end.
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
                Alex-IO turns an inbound email into a priced quote, an interactive layout editor,
                and CAD-ready exports — with admin tools to keep everything grounded in real data.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Pill>Automated first response</Pill>
                <Pill>Interactive layout editor</Pill>
                <Pill>Per-layer exports</Pill>
                <Pill>Foam advisor (curves)</Pill>
                <Pill>Admin ops tools</Pill>
              </div>

              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="#demo"
                  className="rounded-full bg-sky-500/90 px-6 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
                >
                  See it in action
                </a>
                <a
                  href="/quote"
                  className="rounded-full bg-white/10 px-6 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  Open interactive quote
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* CAPABILITIES GALLERY (2-column, tighter, shorter page) */}
        <div id="demo" className="pb-10">
          <SectionTitle
            kicker="THE PRODUCT"
            title="A fast visual flow from email → quote → layout → CAD"
            desc="Keep it simple for customers, powerful for production. Here are the key screens people should see first."
          />

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {/* Left column */}
            <div className="space-y-6">
              <Shot
                src="/splash/hero-quote.png"
                alt="Interactive quote summary"
                caption="Customer-facing quote: specs, pricing, and next step."
                priority
                aspectClass="aspect-[16/9]"
              />

              <Shot
                src="/splash/foam-advisor.png"
                alt="Foam recommendation assistant"
                caption="Foam Advisor: curve-grounded recommendations."
                aspectClass="aspect-[16/10]"
              />
            </div>

            {/* Right column */}
            <div className="space-y-6">
              <Shot
                src="/splash/layout-editor.png"
                alt="Interactive foam layout editor"
                caption="Layout editor: cavities, layers, tools, and apply-to-quote."
                aspectClass="aspect-[16/10]"
              />

              <div className="grid gap-6 sm:grid-cols-2">
                <Shot
                  src="/splash/layer-previews.png"
                  alt="Per-layer layout previews"
                  caption="Per-layer previews"
                  aspectClass="aspect-[4/3]"
                />
                <Shot
                  src="/splash/cad-step.png"
                  alt="CAD STEP model output"
                  caption="CAD output"
                  aspectClass="aspect-[4/3]"
                />
              </div>

              <Shot
                src="/splash/admin-health.png"
                alt="Admin health dashboard"
                caption="Ops visibility: pricing, materials, integrations."
                aspectClass="aspect-[16/10]"
              />
            </div>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <FeatureCard
              title="Layer-aware manufacturing"
              desc="Per-layer thickness, cavities, and optional crop treatment for top pads or finger relief."
            />
            <FeatureCard
              title="Fast layout refinement"
              desc="Align, duplicate, nudge, snap — design the foam visually with tight feedback."
            />
            <FeatureCard
              title="Production-ready outputs"
              desc="Previews + CAD exports stay aligned with what the editor shows."
            />
          </div>
        </div>

        {/* TRY IT (kept, but tighter) */}
        <div className="pb-12">
          <SectionTitle
            kicker="TRY IT"
            title="Send a real-world request and watch it build"
            desc="Use this as a starting point for prospects. Copy/paste an example request and you’re instantly in the flow."
          />
          <div className="mt-6">
            <QuoteHelperPanel />
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

          <div className="mt-10 pb-6 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} Alex-IO. All rights reserved.
          </div>
        </div>
      </Container>
    </main>
  );
}
