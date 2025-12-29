// app/demo/quote/page.tsx
//
// Demo Quote route (locked behavior):
// - Fully interactive example layout
// - Static client-seeded data (never fails)
// - No apply/save/send/export/print controls
// - Clear "Demo Quote" label + 1-line intro
// - CTA: "Start a real quote" -> /start-quote
//

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import InteractiveCanvas from "../../quote/layout/editor/InteractiveCanvas";
import { useLayoutModel } from "../../quote/layout/editor/useLayoutModel";
import type { Cavity } from "../../quote/layout/editor/layoutTypes";

import { getDemoLayoutSeed } from "./demoSeed";

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs font-semibold tracking-widest text-sky-300/80">
        {title}
      </div>
      <div className="mt-3 text-sm text-slate-200">{children}</div>
    </div>
  );
}

function fmtIn(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 16) / 16; // 1/16"
  return `${r}"`;
}

function SelectedSummary({ c }: { c: Cavity | null }) {
  if (!c) return <div className="text-slate-400">Select a cavity to inspect.</div>;

  const isCircle = (c as any).shape === "circle";
  const L = fmtIn((c as any).lengthIn);
  const W = fmtIn((c as any).widthIn);
  const D = fmtIn((c as any).depthIn);

  return (
    <div className="space-y-1">
      <div className="font-semibold text-white">
        {(c as any).label || "Selected cavity"}
      </div>
      <div className="text-slate-300">
        Shape: <span className="text-slate-100">{isCircle ? "Circle" : "Rect"}</span>
      </div>
      <div className="text-slate-300">
        Size:{" "}
        <span className="text-slate-100">
          {isCircle ? `Ø${L} × ${D}` : `${L} × ${W} × ${D}`}
        </span>
      </div>
    </div>
  );
}

export default function DemoQuotePage() {
  const router = useRouter();

  // Seed once (client-only)
  const seed = React.useMemo(() => getDemoLayoutSeed(), []);
  const model = useLayoutModel(seed);

  const block = model.layout.block as any;

  // In your architecture, the hook mirrors active layer cavities into layout.cavities
  const selectedId = model.selectedIds[0] ?? null;
  const selected =
    selectedId ? ((model.layout.cavities as any[]) || []).find((c) => c.id === selectedId) ?? null : null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      {/* subtle editor grid background */}
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

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8">
        {/* Header row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold tracking-widest text-sky-300/80">
              DEMO QUOTE
            </div>
            <div className="mt-1 text-sm text-slate-300">
              Example layout — real quotes start via email.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-full bg-white/5 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/10"
            >
              Back to home
            </a>
            <button
              type="button"
              onClick={() => router.push("/start-quote")}
              className="inline-flex items-center justify-center rounded-full bg-sky-500/90 px-5 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
            >
              Start a real quote
            </button>
          </div>
        </div>

        {/* One-line guidance */}
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-slate-300">
          Explore a real foam layout example — move cavities, inspect spacing, and see how
          Alex-IO interprets manufacturing specs.
        </p>

        {/* Main grid: canvas + inspector */}
        <div className="mt-6 grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
              <InteractiveCanvas
                layout={model.layout as any}
                selectedIds={model.selectedIds}
                selectAction={model.selectCavity}
                moveAction={model.updateCavityPosition}
                resizeAction={(id, lengthIn, widthIn) =>
                  model.updateCavityDims(id, { lengthIn, widthIn } as any)
                }
                zoom={1}
                croppedCorners={false}
              />
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="grid gap-4">
              <Card title="BLOCK (DEMO)">
                <div className="text-slate-300">
                  Size:{" "}
                  <span className="text-slate-100">
                    {fmtIn(block.lengthIn)} × {fmtIn(block.widthIn)} ×{" "}
                    {fmtIn(block.thicknessIn)}
                  </span>
                </div>
                <div className="mt-2 text-slate-300">
                  Material:{" "}
                  <span className="text-slate-100">Expanded Polyethylene (EPE)</span>
                </div>
                <div className="text-slate-300">
                  Density: <span className="text-slate-100">1.7 lb/ft³</span>
                </div>
              </Card>

              <Card title="SELECTED CAVITY">
                <SelectedSummary c={selected as any} />
              </Card>

              <Card title="NOTES">
                <div className="text-slate-300">
                  This is a live demo. Nothing is sent, saved, or exported here.
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
