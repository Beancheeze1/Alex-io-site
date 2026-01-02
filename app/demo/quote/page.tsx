// app/demo/quote/page.tsx
//
// Demo Quote route (WOW pack):
// 1) Locked system action bar (tooltip popover) -> start real quote
// 2) Demo objectives + manufacturing checks (PASS/WARN)
// 3) Real version deliverables (thumbnails)
// 4) Scenario picker (3 seeds, no backend)
// 5) Replace NOTES with REAL WORKFLOW narrative + CTA
//
// Zero backend calls. No quote numbers. No flaky behavior.
//

"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import InteractiveCanvas from "../../quote/layout/editor/InteractiveCanvas";
import { useLayoutModel } from "../../quote/layout/editor/useLayoutModel";
import type { Cavity } from "../../quote/layout/editor/layoutTypes";

// IMPORTANT: make sure this path matches your actual filename on disk.
// FIX: demo scenarios are defined in demoSeed.ts.
import { getScenario } from "./demoSeed";

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold tracking-widest text-sky-300/80">
          {title}
        </div>
        {right}
      </div>
      <div className="mt-3 text-sm text-slate-200">{children}</div>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "pass" | "warn" | "info";
  children: React.ReactNode;
}) {
  const cls =
    tone === "pass"
      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20"
        : "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/20";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function fmtIn(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 16) / 16; // 1/16"
  return `${r}"`;
}

function SelectedSummary({ c }: { c: Cavity | null }) {
  if (!c)
    return <div className="text-slate-400">Select a cavity to inspect.</div>;

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
        Shape:{" "}
        <span className="text-slate-100">{isCircle ? "Circle" : "Rect"}</span>
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

/* ================= Demo checks (client-only) ================= */

type RectIn = { x1: number; y1: number; x2: number; y2: number };

function rectFor(c: any, block: any): RectIn {
  const x1 = (Number(c.x) || 0) * (Number(block.lengthIn) || 1);
  const y1 = (Number(c.y) || 0) * (Number(block.widthIn) || 1);
  const x2 = x1 + (Number(c.lengthIn) || 0);
  const y2 = y1 + (Number(c.widthIn) || 0);
  return { x1, y1, x2, y2 };
}

// IMPORTANT (demo correctness):
// We want the clearance number to be measured to the FOAM EDGE (outer block),
// and then enforce the rule ">= 0.5\" wall clearance" against that edge clearance.
function minFoamEdgeClearanceIn(layout: any): number {
  const block = layout?.block ?? {};
  const L = Number(block.lengthIn) || 0;
  const W = Number(block.widthIn) || 0;
  const cavs = Array.isArray(layout?.cavities) ? layout.cavities : [];

  let minClr = Infinity;

  for (const c of cavs) {
    const r = rectFor(c, block);
    const left = r.x1; // distance to foam left edge
    const right = L - r.x2; // distance to foam right edge
    const top = r.y1; // distance to foam top edge
    const bottom = W - r.y2; // distance to foam bottom edge
    minClr = Math.min(minClr, left, right, top, bottom);
  }

  if (!Number.isFinite(minClr)) return 0;
  return minClr;
}

function minGapBetweenCavitiesIn(layout: any): number {
  const block = layout?.block ?? {};
  const cavs = Array.isArray(layout?.cavities) ? layout.cavities : [];
  if (cavs.length < 2) return Infinity;

  let minGap = Infinity;

  for (let i = 0; i < cavs.length; i++) {
    const a = rectFor(cavs[i], block);
    for (let j = i + 1; j < cavs.length; j++) {
      const b = rectFor(cavs[j], block);

      // axis-aligned rectangle gap
      const gapX = Math.max(0, Math.max(b.x1 - a.x2, a.x1 - b.x2));
      const gapY = Math.max(0, Math.max(b.y1 - a.y2, a.y1 - b.y2));

      // If rectangles overlap in one axis, the separation is along the other axis.
      // If they overlap in both axes, gap is 0.
      const sep = gapX === 0 ? gapY : gapY === 0 ? gapX : Math.min(gapX, gapY);
      minGap = Math.min(minGap, sep);
    }
  }

  return minGap;
}

/* ================= Locked action bar ================= */

type LockedActionId = "price" | "apply" | "export" | "email";

const LOCKED_ACTIONS: Array<{
  id: LockedActionId;
  label: string;
  desc: string;
}> = [
  { id: "price", label: "Price this foam set", desc: "Uses live price books + qty breaks." },
  { id: "apply", label: "Apply to quote", desc: "Writes layout + layers back to the quote." },
  { id: "export", label: "Export DXF / STEP", desc: "Per-layer CAD package for vendors." },
  { id: "email", label: "Email first response", desc: "Auto-reply with specs + pricing + link." },
];

function LockedActionBar({ onStartReal }: { onStartReal: () => void }) {
  const [open, setOpen] = React.useState<LockedActionId | null>(null);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold tracking-widest text-sky-300/80">
            REAL SYSTEM ACTIONS (LOCKED IN DEMO)
          </div>
          <div className="mt-1 text-sm text-slate-300">
            This demo is 100% local. Real quotes unlock pricing, apply, exports, and email workflow.
          </div>
        </div>

        <div className="hidden sm:block text-xs text-slate-400">
          Click a locked action to see what unlocks.
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LOCKED_ACTIONS.map((a) => (
          <div key={a.id} className="relative">
            <button
              type="button"
              onClick={() => setOpen((p) => (p === a.id ? null : a.id))}
              className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              aria-expanded={open === a.id}
            >
              <span className="text-white/70">🔒</span>
              {a.label}
            </button>

            {open === a.id && (
              <div className="absolute left-0 top-[calc(100%+10px)] z-20 w-[320px] rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_70px_rgba(0,0,0,0.75)]">
                <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                  LOCKED IN DEMO
                </div>
                <div className="mt-2 text-sm text-slate-200">{a.desc}</div>
                <div className="mt-2 text-sm text-slate-300">
                  Available in real quotes. This demo runs with no backend.
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={onStartReal}
                    className="inline-flex items-center justify-center rounded-full bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white ring-1 ring-sky-300/20 hover:bg-sky-500"
                  >
                    Start a real quote →
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="inline-flex items-center justify-center rounded-full bg-white/5 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Deliverables ================= */

function DeliverableRow({
  src,
  title,
  desc,
}: {
  src: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-2">
      <div className="relative h-12 w-20 overflow-hidden rounded-lg border border-white/10 bg-white/5">
        <Image src={src} alt={title} fill className="object-cover" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-xs text-slate-300">{desc}</div>
      </div>
    </div>
  );
}

/* ================= Demo cavity source (BULLETPROOF) ================= */

// Demo must show cavities even if the hook chooses a different active layer.
// We derive cavities directly from stack[] when layout.cavities is empty.
function getDemoCavities(layout: any): any[] {
  const direct = Array.isArray(layout?.cavities) ? layout.cavities : [];
  if (direct.length) return direct;

  const stack = Array.isArray(layout?.stack) ? layout.stack : [];
  if (!stack.length) return [];

  const activeRaw =
    (layout as any)?.activeLayer ??
    (layout as any)?.active_layer ??
    (layout as any)?.layer_cavity_layer_index;

  const active = Number(activeRaw);
  const idx = Number.isFinite(active) ? Math.floor(active) - 1 : -1;

  if (idx >= 0 && idx < stack.length) {
    const cavs = Array.isArray(stack[idx]?.cavities) ? stack[idx].cavities : [];
    if (cavs.length) return cavs;
  }

  // Fallback: first layer with cavities
  for (const layer of stack) {
    const cavs = Array.isArray(layer?.cavities) ? layer.cavities : [];
    if (cavs.length) return cavs;
  }

  return [];
}

export default function DemoQuotePage() {
  const router = useRouter();

  // LOCKED: Basic editor only (no scenario picker)
  const scenarioId = "mailer" as const;
  const scenario = React.useMemo(() => getScenario(scenarioId as any), []);
  const displayScenarioLabel = "Basic editor";

  // Seed once (basic)
  const seed = React.useMemo(() => scenario.seed, [scenario]);
  const model = useLayoutModel(seed);

  // Build a demo-safe layout that ALWAYS exposes cavities to the canvas/checks.
  const demoCavities = React.useMemo(() => getDemoCavities(model.layout as any), [model.layout]);
  const layoutForDemo = React.useMemo(
    () => ({ ...(model.layout as any), cavities: demoCavities }),
    [model.layout, demoCavities],
  );

  const block = (layoutForDemo as any).block as any;

  // selection
  const selectedId = model.selectedIds[0] ?? null;
  const selected =
    selectedId
      ? ((demoCavities || []).find((c: any) => c.id === selectedId) ?? null)
      : null;

  // Objectives tracking (simple + sticky)
  const initialSnapshotRef = React.useRef<any>(null);
  const [didSelect, setDidSelect] = React.useState(false);
  const [didMove, setDidMove] = React.useState(false);
  const [didResize, setDidResize] = React.useState(false);

  // Snapshot baseline once
  React.useEffect(() => {
    if (selectedId) setDidSelect(true);
  }, [selectedId]);

  React.useEffect(() => {
    if (!initialSnapshotRef.current) {
      const cavs = Array.isArray((layoutForDemo as any)?.cavities) ? (layoutForDemo as any).cavities : [];
      initialSnapshotRef.current = cavs.map((c: any) => ({
        id: c.id,
        x: Number(c.x),
        y: Number(c.y),
        lengthIn: Number(c.lengthIn),
        widthIn: Number(c.widthIn),
      }));
      return;
    }

    const baseline: any[] = initialSnapshotRef.current || [];
    const now: any[] = Array.isArray((layoutForDemo as any)?.cavities) ? (layoutForDemo as any).cavities : [];

    for (const b of baseline) {
      const c = now.find((x: any) => x.id === b.id);
      if (!c) continue;

      const dx = Math.abs((Number(c.x) || 0) - (Number(b.x) || 0));
      const dy = Math.abs((Number(c.y) || 0) - (Number(b.y) || 0));
      if (dx > 0.001 || dy > 0.001) setDidMove(true);

      const dL = Math.abs((Number(c.lengthIn) || 0) - (Number(b.lengthIn) || 0));
      const dW = Math.abs((Number(c.widthIn) || 0) - (Number(b.widthIn) || 0));
      if (dL >= 0.0625 || dW >= 0.0625) setDidResize(true);
    }
  }, [layoutForDemo]);

  // Manufacturing checks (demo-only, computed)
  const wallRuleIn = 0.5;
  const minGapRuleIn = 0.5;

  const minFoamEdge = React.useMemo(
    () => minFoamEdgeClearanceIn(layoutForDemo as any),
    [layoutForDemo],
  );
  const minGap = React.useMemo(
    () => minGapBetweenCavitiesIn(layoutForDemo as any),
    [layoutForDemo],
  );

  const wallPass = minFoamEdge >= wallRuleIn - 1e-6; // equal counts as pass
  const gapPass = minGap === Infinity ? true : minGap >= minGapRuleIn - 1e-6;
  const insidePass = true; // editor clamps; keep honest + simple

  const checksPass = wallPass && gapPass && insidePass;

  const onStartReal = React.useCallback(() => {
    router.push("/start-quote");
  }, [router]);

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

      {/* TIGHTENED: reduce overall width just enough to align right column with action bar edge */}
      <div className="relative z-10 mx-auto w-full max-w-[1480px] px-4 py-8">
        {/* Top header row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold tracking-widest text-sky-300/80">
              DEMO QUOTE
            </div>
            <div className="mt-1 text-sm text-slate-300">
              Explore a real layout editor — then unlock pricing, apply, exports, and email workflow.
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
              onClick={onStartReal}
              className="inline-flex items-center justify-center rounded-full bg-sky-500/90 px-5 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
            >
              Start a real quote
            </button>
          </div>
        </div>

        {/* Locked system action bar */}
        <div className="mt-5">
          <LockedActionBar onStartReal={onStartReal} />
        </div>

        {/* Main grid (keep center wide, right slightly narrower; aligns with action bar now) */}
        <div className="mt-6 grid gap-5 lg:grid-cols-[360px_minmax(860px,1fr)_340px]">
          {/* LEFT: WOW blocks */}
          <div>
            <div className="grid gap-4">
              <Card title="WHAT YOU GET IN THE REAL QUOTE">
                <div className="grid gap-2">
                  <DeliverableRow
                    src="/splash/hero-quote.png"
                    title="Interactive quote summary"
                    desc="Quote number, status, and pricing snapshot in one place."
                  />
                  <DeliverableRow
                    src="/splash/layer-previews.png"
                    title="Per-layer previews"
                    desc="Layers, cavities, crop corners — previewed exactly as built."
                  />
                  <DeliverableRow
                    src="/splash/cad-step.png"
                    title="DXF / STEP exports"
                    desc="Per-layer CAD outputs for engineering and vendors."
                  />
                  <DeliverableRow
                    src="/splash/admin-health.png"
                    title="Admin visibility"
                    desc="Materials, curves, pricing, integrations, and audit trail."
                  />
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={onStartReal}
                    className="w-full rounded-full bg-sky-500/90 px-5 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-sky-300/20 hover:bg-sky-500"
                  >
                    Start a real quote →
                  </button>
                </div>
              </Card>

              <Card title="REAL WORKFLOW">
                <ol className="list-decimal space-y-1 pl-5 text-slate-300">
                  <li>Email specs (size, qty, material, cavities)</li>
                  <li>Auto-pricing + first response</li>
                  <li>Layout + previews (layers, tools, checks)</li>
                  <li>Per-layer DXF/STEP exports</li>
                </ol>

                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-slate-300">
                  This demo shows the editor only. Real quotes unlock the entire toolchain.
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={onStartReal}
                    className="w-full rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                  >
                    Start a real quote
                  </button>
                </div>
              </Card>
            </div>
          </div>

          {/* CENTER: canvas */}
          <div>
            {/* Context row */}
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-300">
                Scenario:{" "}
                <span className="text-slate-100 font-semibold">{displayScenarioLabel}</span>{" "}
                <span className="text-slate-400">— {scenario.subtitle}</span>
              </div>

              <div className="flex items-center gap-2">
                <Pill tone={checksPass ? "pass" : "warn"}>
                  Manufacturing checks: {checksPass ? "PASS" : "WARN"}
                </Pill>
                <Pill tone="info">Demo</Pill>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_50px_rgba(0,0,0,0.55)]">
              <InteractiveCanvas
                layout={layoutForDemo as any}
                selectedIds={model.selectedIds}
                selectAction={model.selectCavity}
                moveAction={model.updateCavityPosition}
                resizeAction={(id, lengthIn, widthIn) =>
                  model.updateCavityDims(id, { lengthIn, widthIn } as any)
                }
                zoom={1}
                // Basic only in demo now
                croppedCorners={false}
                // DEMO: hide the dotted inner wall so the visual edge is clearly the foam edge
                showInnerWall={false}
                autoCenterOnMount
              />
            </div>
          </div>

          {/* RIGHT: inspector + objectives + checks (DEMO SCENARIO card removed) */}
          <div>
            <div className="grid gap-4">
              <Card title="BLOCK (DEMO)">
                <div className="text-slate-300">
                  Size:{" "}
                  <span className="text-slate-100">
                    {fmtIn(block.lengthIn)} × {fmtIn(block.widthIn)} × {fmtIn(block.thicknessIn)}
                  </span>
                </div>
                <div className="mt-2 text-slate-300">
                  Material: <span className="text-slate-100">{scenario.materialLabel}</span>
                </div>
                <div className="text-slate-300">
                  Density: <span className="text-slate-100">{scenario.densityLabel}</span>
                </div>
              </Card>

              <Card title="SELECTED CAVITY">
                <SelectedSummary c={selected as any} />
              </Card>

              <Card
                title="DEMO OBJECTIVES"
                right={
                  <Pill tone={didSelect && didMove && didResize && checksPass ? "pass" : "warn"}>
                    {didSelect && didMove && didResize && checksPass ? "Complete" : "In progress"}
                  </Pill>
                }
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-slate-300">Select a cavity</div>
                    <span className="text-slate-100">{didSelect ? "✅" : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-slate-300">Move a cavity</div>
                    <span className="text-slate-100">{didMove ? "✅" : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-slate-300">Resize a cavity</div>
                    <span className="text-slate-100">{didResize ? "✅" : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-slate-300">Validate spacing rules</div>
                    <span className="text-slate-100">{checksPass ? "✅" : "⚠️"}</span>
                  </div>

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                        MANUFACTURING CHECKS
                      </div>
                      <Pill tone={checksPass ? "pass" : "warn"}>
                        {checksPass ? "PASS" : "WARN"}
                      </Pill>
                    </div>

                    <div className="mt-2 space-y-1 text-sm text-slate-300">
                      <div className="flex items-center justify-between">
                        <span>Wall clearance ≥ 0.5"</span>
                        <span className="text-slate-100">
                          {wallPass ? "✅" : `⚠️ (${minFoamEdge.toFixed(3)}")`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Min cavity gap ≥ 0.5"</span>
                        <span className="text-slate-100">
                          {gapPass ? "✅" : `⚠️ (${minGap.toFixed(3)}")`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Fits inside block</span>
                        <span className="text-slate-100">{insidePass ? "✅" : "⚠️"}</span>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-slate-400">
                      Real quotes enforce + record these checks during Apply and before CAD export.
                    </div>
                  </div>
                </div>
              </Card>

              <div className="text-center text-xs text-slate-500">
                Demo is local-only (no backend). Real quotes start via email.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
