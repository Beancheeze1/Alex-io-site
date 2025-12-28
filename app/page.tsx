// app/page.tsx
import BrandCard from "@/components/BrandCard";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      {children}
    </div>
  );
}

function Pill({
  children,
  className = "",
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold shadow-sm ring-1 transition " +
    "ring-white/15 bg-white/10 text-white hover:bg-white/15 hover:ring-white/25";
  if (href) {
    return (
      <a href={href} className={`${base} ${className}`}>
        {children}
      </a>
    );
  }
  return <span className={`${base} ${className}`}>{children}</span>;
}

function Card({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      {eyebrow ? (
        <div className="text-[11px] font-bold uppercase tracking-[0.20em] text-white/60">
          {eyebrow}
        </div>
      ) : null}
      <div className="mt-2 text-lg font-semibold text-white">{title}</div>
      <div className="mt-3 text-sm leading-6 text-white/70">{children}</div>
    </div>
  );
}

function ScreenshotCard({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  // Placeholder block on purpose (Path A: no new assets required).
  // When you’re ready, we can swap this to <Image /> with real screenshots.
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.30)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-white/60">{caption}</div>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold tracking-wide text-white/70 ring-1 ring-white/10">
          Screenshot
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent">
        <div className="flex h-44 items-center justify-center px-6 text-center text-xs text-white/50">
          Drop screenshot here later (we’ll wire real images when you’re ready)
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-950 text-slate-50">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute top-40 left-10 h-[420px] w-[420px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute bottom-24 right-10 h-[420px] w-[420px] rounded-full bg-cyan-400/10 blur-3xl" />
      </div>

      <Container>
        {/* Top brand */}
        <div className="relative flex flex-col items-center">
          <BrandCard />

          {/* Hero */}
          <div className="mt-10 w-full max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Live workflow: email → quote → layout → exports → send
            </div>

            <h1 className="mt-5 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
              Instant quoting + foam layout + CAD exports —
              <span className="text-white/80"> straight from an email.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-3xl text-pretty text-base leading-7 text-white/70">
              Alex-IO turns a customer spec into a clean quote, an interactive
              layout editor (layers + cavities), and production-ready exports —
              with real email delivery and thread continuity.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Pill href="#demo" className="ring-white/25 bg-white/15 hover:bg-white/20">
                Watch demo
              </Pill>

              {/* Safe link — you can point this to a real demo quote later */}
              <Pill href="/quote?quote_no=DEMO">
                Open demo quote
              </Pill>

              <Pill href="#capabilities" className="bg-transparent hover:bg-white/10">
                See capabilities
              </Pill>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-white/55">
              <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                Real email send (Graph)
              </span>
              <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                Quote thread continuity
              </span>
              <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                Per-layer exports
              </span>
              <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                Admin send + revision labels
              </span>
            </div>
          </div>

          {/* How it works */}
          <div className="mt-10 w-full max-w-6xl rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.20em] text-white/60">
                  How it works
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  A full quoting workflow — not a chat toy
                </div>
              </div>
              <div className="text-xs text-white/55">
                Built for real packaging + manufacturing quoting
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-5">
              {[
                { n: "01", t: "Email spec", d: "Customer sends dimensions, qty, material." },
                { n: "02", t: "Quote reply", d: "Instant quote with link + next steps." },
                { n: "03", t: "Layout editor", d: "Layers, cavities, crop toggles, metrics." },
                { n: "04", t: "Apply & export", d: "Store package + generate per-layer CAD." },
                { n: "05", t: "Send to customer", d: "Admin sends final quote via real email." },
              ].map((s) => (
                <div
                  key={s.n}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="text-xs font-extrabold tracking-wide text-white/60">
                    {s.n}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {s.t}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-white/60">
                    {s.d}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Capabilities */}
          <div id="capabilities" className="mt-10 w-full max-w-6xl">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.20em] text-white/60">
                  Capabilities
                </div>
                <div className="mt-2 text-2xl font-extrabold tracking-tight text-white">
                  What Alex-IO does well
                </div>
              </div>
              <div className="hidden text-sm text-white/60 sm:block">
                Clean UI • Hard rules • Production workflow
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Card title="Quote generation with real-world pricing behavior" eyebrow="Pricing">
                Volumetric pricing, kerf/waste handling, minimum charge behavior,
                and stable quote numbers per thread — built to match how shops
                actually quote.
              </Card>

              <Card title="Interactive foam layout editor (layers + cavities)" eyebrow="Layout">
                Design foam layers, place cavities, toggle crop corners per layer,
                and apply updates to the quote without breaking the workflow.
              </Card>

              <Card title="Manufacturing exports aligned to the layout" eyebrow="CAD">
                Per-layer exports (DXF/STEP) reflect layer geometry and cut logic
                so the CAD output matches what the layout shows.
              </Card>

              <Card title="Admin tooling that closes the loop" eyebrow="Ops">
                Internal admin quote view, revision labels, and an admin “Send to
                customer” action for final delivery through real email.
              </Card>
            </div>
          </div>

          {/* Screenshots (placeholders) */}
          <div className="mt-10 w-full max-w-6xl">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.20em] text-white/60">
                  Screenshots
                </div>
                <div className="mt-2 text-2xl font-extrabold tracking-tight text-white">
                  The “wow factor” — in one scroll
                </div>
              </div>
              <div className="hidden text-sm text-white/60 sm:block">
                We’ll swap in your real screenshots next
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <ScreenshotCard
                title="Email quote reply"
                caption="Clean quote email + customer link"
              />
              <ScreenshotCard
                title="Interactive quote viewer"
                caption="Print • forward • schedule • carton suggestions"
              />
              <ScreenshotCard
                title="Layout editor"
                caption="Layers • cavities • metrics • basic/advanced"
              />
              <ScreenshotCard
                title="Per-layer previews"
                caption="Layer-specific geometry + pocket depth"
              />
              <ScreenshotCard
                title="Admin quote view"
                caption="Revision label + send to customer"
              />
              <ScreenshotCard
                title="Exports"
                caption="Per-layer DXF/STEP aligned to the layout"
              />
            </div>
          </div>

          {/* Demo section */}
          <div id="demo" className="mt-12 w-full max-w-6xl">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.20em] text-white/60">
                    Demo
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    Want the quickest “show me” path?
                  </div>
                  <div className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
                    Start with the helper below (example input), then open the demo quote.
                    If you want a true 60-second video demo, we’ll add a real embedded
                    clip here next.
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:items-end">
                  <Pill href="/quote?quote_no=DEMO" className="ring-white/25 bg-white/15 hover:bg-white/20">
                    Open demo quote
                  </Pill>
                  <div className="text-xs text-white/50">
                    Safe demo link — no email sends
                  </div>
                </div>
              </div>

              {/* Your existing example input helper panel */}
              <div className="mt-6">
                <QuoteHelperPanel />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-10 w-full max-w-6xl pb-6 text-center text-xs text-white/45">
            Alex-IO • Internal production build • Splash page (Option 2 marketing shell)
          </div>
        </div>
      </Container>
    </main>
  );
}
