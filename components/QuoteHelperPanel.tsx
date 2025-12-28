// components/QuoteHelperPanel.tsx

"use client";

import * as React from "react";

export default function QuoteHelperPanel({ className }: { className?: string }) {
  const checklist = [
    "Outside size (L×W×H, inches)",
    "Quantity to quote",
    "Foam family (PE, EPE, or PU)",
    "Density (e.g., 1.7 lb)",
    "Number of cavities / pockets (if any)",
    "Cavity sizes (L×W×Depth, or Ødiameter×depth for round)",
  ];

  const example = [
    "Outside size: 18x12x3 in",
    "Quantity: 250",
    "Foam family: EPE",
    "Density: 1.7 lb",
    "Cavities: 2",
    "Cavity sizes: Ø6x1, 3x3x1",
  ].join("\n");

  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<number | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(example);
      setCopied(true);

      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Fallback for older browsers / clipboard blocked
      try {
        const ta = document.createElement("textarea");
        ta.value = example;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);

        setCopied(true);
        if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
      } catch {
        // If even fallback fails, do nothing (silent).
      }
    }
  }

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  return (
    <section className={className ?? "mx-auto max-w-3xl"}>
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_80px_rgba(0,0,0,0.55)]">
        {/* subtle top glow like the rest of the splash */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent" />

        <div className="relative">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                EXAMPLE INPUT
              </div>
              <h2 className="mt-1 text-base font-semibold text-white">
                A clean quote request (fastest turnaround)
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Copy/paste this structure into your first email so Alex-IO can
                price and build the layout with minimal back-and-forth.
              </p>
            </div>

            <span className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10">
              Email-ready
            </span>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Checklist */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="mb-2 text-xs font-semibold tracking-widest text-slate-200/90">
                INCLUDE THESE
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
                {checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            {/* Example block */}
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold tracking-widest text-slate-200/90">
                    COPY / PASTE
                  </div>
                  <div className="text-[11px] text-slate-400">plain text</div>
                </div>

                <button
                  type="button"
                  onClick={handleCopy}
                  className={[
                    "rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition",
                    copied
                      ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/20"
                      : "bg-white/5 text-slate-200 ring-white/10 hover:bg-white/10",
                  ].join(" ")}
                  aria-label="Copy example quote request to clipboard"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-neutral-950/70 p-4 font-mono text-xs leading-relaxed text-slate-100 whitespace-pre-wrap">
                {example}
              </div>

              <div className="mt-3 text-[11px] text-slate-400">
                Tip: If you need a tight fit into a carton/mailer, mention any
                clearance requirements.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
