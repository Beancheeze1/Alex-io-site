// app/page.tsx
import type { ReactNode } from "react";
import Image from "next/image";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";
import SplashChatWidget from "@/components/SplashChatWidget";

const DEMO_QUOTE_PATH = "/demo/quote";
const START_QUOTE_PATH = "/start-quote";

function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4">{children}</div>;
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function MiniCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{desc}</div>
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
        "group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-card)]",
        className,
      ].join(" ")}
    >
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
        <div className="absolute inset-0 bg-[var(--surface-subtle)]" />
      </div>
    </div>
  );
}

function EmailSampleInline() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">
          FIRST RESPONSE (SAMPLE)
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
          auto-reply
        </span>
      </div>

      <div className="mt-3 text-sm">
        <div className="font-medium text-[var(--text-primary)]">
          Subject: Foam quote {`{#}`} — specs + pricing + next steps
        </div>
        <div className="mt-2 leading-relaxed text-[var(--text-secondary)]">
          We pulled the key specs from your email, priced the foam set, and
          generated an interactive quote. If anything looks off, reply with a
          correction and we’ll update it.
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            Open quote
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            Edit layout
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
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
      {/* Base card */}
      <div className="relative">
        <Shot
          src="/splash/hero-quote.png"
          alt="Alex-IO interactive quote summary"
          priority
          aspect="aspect-[16/10]"
        />
      </div>

      {/* Top snip (Admin health) */}
      <div className="absolute -right-3 top-7 w-[62%] rotate-[1.5deg] sm:-right-6 sm:top-8 sm:w-[58%]">
        <Shot
          src="/splash/admin-health.png"
          alt="Admin health dashboard"
          aspect="aspect-[16/10]"
          className="shadow-sm"
        />
      </div>

      {/* Bottom snip (Layer previews) */}
      <div className="absolute -left-3 bottom-7 w-[58%] -rotate-[1.25deg] sm:-left-6 sm:bottom-8 sm:w-[55%]">
        <Shot
          src="/splash/layer-previews.png"
          alt="Per-layer layout previews"
          aspect="aspect-[16/10]"
          className="shadow-sm"
        />
      </div>

      {/* Keep layout height reserved so overlaps don't collapse */}
      <div className="pointer-events-none mt-6 h-24 sm:h-28" />
    </div>
  );
}

// Splash CTAs (locked): demo + start-quote (no mailto)

export default function Page({
  searchParams,
}: {
  searchParams?: { sales_rep_slug?: string };
}) {
  // If a salesperson link was used, thread the slug through to the editor
  // so the quote gets attributed to the right rep.
  const salesSlug = searchParams?.sales_rep_slug?.trim() || "";
  const startQuotePath = salesSlug
    ? `/start-quote?sales_rep_slug=${encodeURIComponent(salesSlug)}`
    : START_QUOTE_PATH;
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--surface-page)] text-[var(--text-primary)]">
      {/* System-style header band */}
      <header className="relative z-10">
        <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
          <Container>
            <div className="flex items-center justify-between py-4">
              <div>
                <div className="text-[11px] font-medium tracking-[0.14em] uppercase text-[var(--text-muted)]">
                  Powered by
                </div>
                <div className="text-lg font-medium text-[var(--text-primary)]">
                  Alex-IO
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Quoting · Layout · CAD
                </div>
              </div>

              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                Automated Quoting Assistant
              </span>
            </div>
          </Container>
        </div>
      </header>

      {/* HERO (left story + right overlap snips) */}
      <section className="relative z-10">
        <Container>
          <div className="pb-10 pt-8 sm:pb-12 sm:pt-10">
            <div className="grid items-start gap-8 lg:grid-cols-12">
              {/* Left */}
              <div className="lg:col-span-6">
                <Kicker>EMAIL → QUOTE → LAYOUT → CAD</Kicker>

                <p className="mt-3 text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
                  Pricing, cavity layout, layered sets, and CAD-ready outputs—one
                  connected workflow that starts with just a single email.
                </p>

                <div className="mt-5 grid gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-[var(--action-primary)]" />
                    <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      Send a normal RFQ email (size, quantity, material, and any
                      cavities).
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-[var(--action-primary)]" />
                    <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      Get an automated first response with specs + pricing and a
                      link to the interactive quote.
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-[var(--action-primary)]" />
                    <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      Build the layout: layers, cavities, previews — all tied to
                      the quote.
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-[var(--action-primary)]" />
                    <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      Export per-layer DXF/STEP for engineering and vendors.
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a
                    href={START_QUOTE_PATH}
                    className="inline-flex items-center justify-center rounded-md bg-[var(--action-primary)] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--action-primary-hover)]"
                  >
                    Start a Quote
                  </a>

                  <a
                    href={DEMO_QUOTE_PATH}
                    className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-6 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
                  >
                    Try the Interactive Quote
                  </a>
                </div>

                {/* Email sample integrated into left story */}
                <div className="mt-6">
                  <EmailSampleInline />
                </div>
              </div>

              {/* Right: overlapping snips */}
              <div className="lg:col-span-6">
                <OverlapSnips />
                <div className="mt-2 text-center text-xs text-[var(--text-muted)]">
                  One flow across customer view, previews, and admin visibility.
                </div>
              </div>
            </div>

            {/* “Example Input” row */}
            <div className="mt-10 grid gap-5 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                      EXAMPLE INPUT
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      copy/paste into an email
                    </span>
                  </div>

                  <div className="mt-3">
                    <QuoteHelperPanel className="max-w-none mx-0" />
                  </div>
                </div>
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
              <h2 className="mt-2 text-2xl font-medium tracking-tight text-[var(--text-primary)] sm:text-3xl">
                Everything stays connected.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
                Quotes, layouts, previews, CAD, and admin visibility — designed
                to feel like one unified toolchain.
              </p>
            </div>

            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <div>
                <Shot
                  src="/splash/cad-step.png"
                  alt="CAD STEP model output"
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  CAD output: DXF/STEP for engineering + vendors.
                </div>
              </div>

              <div>
                <Shot
                  src="/splash/admin-health.png"
                  alt="Admin health dashboard"
                  aspect="aspect-[16/10]"
                />
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  Admin tools: materials, pricing, curves, integrations.
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Shot
                src="/splash/layout-editor.png"
                alt="Interactive foam layout editor"
                aspect="aspect-[21/9]"
                className="shadow-sm"
              />
              <div className="mt-2 text-xs text-[var(--text-muted)]">
                Layout editor: layers · cavity tools · manufacturing intent.
              </div>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={START_QUOTE_PATH}
                className="rounded-md bg-[var(--action-primary)] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--action-primary-hover)]"
              >
                Start a Quote
              </a>
            </div>

            <div className="mt-10 text-center text-xs text-[var(--text-faint)]">
              © {new Date().getFullYear()} Alex-IO. All rights reserved.
            </div>
          </div>
        </Container>
      </section>

      {/* ADDITIVE: Splash chat widget (UI + guided intake). No existing workflows touched. */}
      <SplashChatWidget startQuotePath={startQuotePath} />
    </main>
  );
}

