// components/LandingChatWidget.tsx
//
// Chat widget for the /landing page.
//
// Identical UX to SplashChatWidget (same AI brain at /api/widget/chat,
// same WidgetFacts structure, same localStorage persistence, same quick-replies)
// with ONE difference: when the AI signals done=true and the prospect clicks
// "Open layout & pricing", we POST to /api/demo/seed instead of navigating to
// /start-quote?prefill=...
//
// This means the prospect goes into the REAL layout editor via a real DB-backed
// demo quote (is_demo=true) instead of the regular StartQuoteModal flow.
//
// ISOLATION GUARANTEE:
// - SplashChatWidget.tsx is NOT modified
// - /api/widget/chat is NOT modified (same brain, same API)
// - /start-quote and StartQuoteModal are NOT touched
// - The only new dependency is /api/demo/seed (new file)

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// ── Types (mirrors SplashChatWidget — kept local so no shared import risk) ────

type WidgetFacts = {
  outsideL?: string;
  outsideW?: string;
  outsideH?: string;
  qty?: string;
  shipMode?: "box" | "mailer" | "unsure";
  insertType?: "single" | "set" | "unsure";
  pocketsOn?: "base" | "top" | "both" | "unsure";
  holding?: "pockets" | "loose" | "unsure";
  pocketCount?: "1" | "2" | "3+" | "unsure";
  materialMode?: "recommend" | "known";
  materialText?: string;
  materialId?: number | null;
  packagingSku?: string | null;
  packagingChoice?: "stock" | "custom" | null;
  printed?: boolean | null;
  layerCount?: "1" | "2" | "3" | "4";
  layerThicknesses?: string[];
  cavities?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  notes?: string;
  createdAtIso?: string;
};

type Msg = {
  id: string;
  role: "bot" | "user";
  text: string;
};

const LS_KEY = "alexio_landing_widget_v4"; // bumped to clear stale broken state

function uid() {
  return `m-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ── Summary helper (mirrors SplashChatWidget) ─────────────────────────────────

function summarizeFacts(facts: WidgetFacts): string[] {
  const dims =
    facts.outsideL && facts.outsideW && facts.outsideH
      ? `${facts.outsideL}×${facts.outsideW}×${facts.outsideH} in`
      : "(size not set)";

  const lines: (string | null)[] = [
    `Outside size: ${dims}`,
    facts.qty ? `Quantity: ${facts.qty}` : "Quantity: (not set)",
    facts.shipMode ? `Shipping: ${facts.shipMode}` : null,
    facts.insertType ? `Insert: ${facts.insertType}` : null,
    facts.cavities?.trim() ? `Pockets: ${facts.cavities.trim()}` : null,
    facts.materialMode === "known" && facts.materialText
      ? `Material: ${facts.materialText}`
      : facts.materialMode === "recommend"
      ? "Material: Recommended"
      : null,
    facts.notes?.trim() ? `Notes: ${facts.notes.trim()}` : null,
  ];

  return lines.filter((l): l is string => !!l);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LandingChatWidget() {
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [minimizedHint, setMinimizedHint] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [seedError, setSeedError] = React.useState(false);

  const [facts, setFacts] = React.useState<WidgetFacts>(() => {
    const saved = safeJsonParse<{ facts: WidgetFacts }>(
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null,
    );
    return saved?.facts ?? { createdAtIso: new Date().toISOString() };
  });

  const [msgs, setMsgs] = React.useState<Msg[]>(() => {
    const saved = safeJsonParse<{ msgs: Msg[] }>(
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null,
    );
    if (saved?.msgs?.length) return saved.msgs;
    return [
      {
        id: uid(),
        role: "bot",
        text: "Hey — I can build you a real quote in a couple of minutes. Tell me what you're making and what you know so far.",
      },
      {
        id: uid(),
        role: "bot",
        text: "Start with outside foam size (L×W×H, inches) if you have it.",
      },
    ];
  });

  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<boolean>(() => {
    const saved = safeJsonParse<{ done: boolean }>(
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null,
    );
    return saved?.done ?? false;
  });
  const [quickReplies, setQuickReplies] = React.useState<string[]>(() => {
    const saved = safeJsonParse<{ quickReplies: string[] }>(
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null,
    );
    return saved?.quickReplies ?? [];
  });

  const listRef = React.useRef<HTMLDivElement | null>(null);
  const doneCardRef = React.useRef<HTMLDivElement | null>(null);

  // Keep latest facts in a ref so openDemo() never reads stale state
  const latestFactsRef = React.useRef<WidgetFacts>(facts);
  React.useEffect(() => { latestFactsRef.current = facts; }, [facts]);

  // Persist to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ facts, msgs, done, quickReplies }));
    } catch { /* ignore */ }
  }, [facts, msgs, done, quickReplies]);

  // Auto-scroll messages
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, msgs.length]);

  // Scroll done card into view when done flips
  React.useEffect(() => {
    if (!done || !open) return;
    setTimeout(() => {
      doneCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }, [done, open]);

  // Escape to close
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Reset ──────────────────────────────────────────────────────────────────

  function reset() {
    const freshFacts: WidgetFacts = { createdAtIso: new Date().toISOString() };
    setFacts(freshFacts);
    setMsgs([
      {
        id: uid(),
        role: "bot",
        text: "Fresh start — tell me what you're making and what you know so far.",
      },
    ]);
    setDone(false);
    setQuickReplies([]);
    setInput("");
    setSeedError(false);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }

  // ── AI brain call (same endpoint as SplashChatWidget) ─────────────────────

  async function callBrain(userText: string, msgsSnap: Msg[], factsSnap: WidgetFacts) {
    const res = await fetch("/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        messages: msgsSnap.map((m) => ({ role: m.role, text: m.text })),
        userText,
        facts: factsSnap,
      }),
    });
    return res.json();
  }

  async function handleSend(text: string) {
    const t = text.trim();
    if (!t || busy) return;

    const userMsg: Msg = { id: uid(), role: "user", text: t };
    const msgsSnap = [...msgs, userMsg];
    const factsSnap = { ...facts };

    setBusy(true);
    setMsgs(msgsSnap);

    try {
      const data = await callBrain(t, msgsSnap, factsSnap);

      const mergedFacts: WidgetFacts =
        data.facts && typeof data.facts === "object"
          ? { ...factsSnap, ...data.facts }
          : factsSnap;

      setFacts(mergedFacts);
      setMsgs((prev) => [...prev, { id: uid(), role: "bot", text: data.assistantMessage }]);

      // Mirror SplashChatWidget exactly: set done directly from data.done
      // Do NOT gate on isReady() here — the API already checks that server-side.
      // Extra client-side gating was causing done to silently stay false.
      setDone(Boolean(data.done));
      setQuickReplies(
        Array.isArray(data.quickReplies) ? data.quickReplies.slice(0, 6) : []
      );
    } catch {
      setMsgs((prev) => [
        ...prev,
        {
          id: uid(),
          role: "bot",
          text: "Quick hiccup on my side — try that again, or give me outside size (L×W×H) and qty.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  // ── Demo seed ─────────────────────────────────────────────────────────────
  // Step 1: POST to /api/demo/seed to create the Q-DEMO- quote in DB.
  // Step 2: Navigate to /start-quote?prefill=... with the Q-DEMO- quote number
  //         baked into the prefill so StartQuoteModal uses it.
  //
  // This mirrors the landing form flow exactly — the prospect goes through
  // all StartQuoteModal steps (type → specs → cavities → material → review)
  // before hitting the editor. The Q-DEMO- quote_no threads through so the
  // apply route can find the existing DB row without auth.

  async function openDemo() {
    const f = latestFactsRef.current;

    setSeedError(false);
    setSeeding(true);

    try {
      // Step 1: seed the demo quote in DB
      const res = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outsideL: f.outsideL ?? "",
          outsideW: f.outsideW ?? "",
          outsideH: f.outsideH ?? "",
          qty: f.qty ?? "",
          customerName: f.customerName ?? "",
          customerEmail: f.customerEmail ?? "",
          shipMode: f.shipMode ?? "unsure",
          insertType: f.insertType ?? "single",
          holding: f.holding ?? "pockets",
          pocketCount: f.pocketCount ?? "1",
          layerCount: f.layerCount ?? "1",
          layerThicknesses: f.layerThicknesses ?? [],
          materialMode: f.materialMode ?? "recommend",
          materialText: f.materialText ?? "",
          materialId: f.materialId ?? null,
          cavities: f.cavities ?? "",
          notes: f.notes ?? "",
          packagingSku: f.packagingSku ?? "",
          packagingChoice: f.packagingChoice ?? null,
          printed: f.printed ?? false,
          source: "landing-widget",
        }),
      });

      const data = await res.json().catch(() => ({ ok: false }));

      if (!data?.ok || !data?.quoteNo) {
        setSeedError(true);
        setSeeding(false);
        return;
      }

      // Step 2: build prefill payload with the Q-DEMO- quote number baked in,
      // mirroring exactly what the landing form does. StartQuoteModal reads
      // prefill.quoteNo and uses it instead of generating a fresh Q-AI- number.
      const prefill = {
        quoteNo: data.quoteNo,               // Q-DEMO-... — StartQuoteModal uses this
        source: "landing-widget",
        createdAtIso: f.createdAtIso ?? new Date().toISOString(),
        outside: {
          l: f.outsideL ?? "",
          w: f.outsideW ?? "",
          h: f.outsideH ?? "",
          units: "in",
        },
        qty: f.qty ?? "",
        shipMode: f.shipMode ?? "unsure",
        insertType: f.insertType ?? "single",
        pocketsOn: f.pocketsOn ?? "",
        holding: f.holding ?? "pockets",
        pocketCount: f.pocketCount ?? "1",
        material: {
          mode: f.materialMode ?? "recommend",
          text: f.materialText ?? "",
          id: f.materialId ?? null,
        },
        packagingSku: f.packagingSku ?? "",
        packagingChoice: f.packagingChoice ?? null,
        printed: f.printed ?? false,
        layerCount: f.layerCount ?? "1",
        layerThicknesses: Array.isArray(f.layerThicknesses) ? f.layerThicknesses : [],
        cavities: f.cavities ?? "",
        customerName: f.customerName ?? "",
        customerEmail: f.customerEmail ?? "",
        notes: f.notes ?? "",
      };

      router.push(
        `/start-quote?prefill=${encodeURIComponent(JSON.stringify(prefill))}&demo=1`,
      );
    } catch {
      setSeedError(true);
      setSeeding(false);
    }
  }

  const summaryLines = React.useMemo(() => summarizeFacts(facts), [facts]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed bottom-4 right-3 sm:bottom-5 sm:right-5 z-[80]">
      <style>{`
        @keyframes fadeInAnnotation {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(-2deg); }
          50%       { transform: rotate(2deg); }
        }
        .chat-annotation {
          animation: fadeInAnnotation 0.6s ease 1.2s both;
        }
        .chat-annotation-text {
          animation: wiggle 3s ease-in-out 2s infinite;
          transform-origin: right center;
        }
      `}</style>

      {/* Hand-drawn annotation — visible until widget is opened */}
      {!open && (
        <div
          className="chat-annotation hidden sm:flex"
          style={{
            position: "absolute",
            bottom: "100%",
            right: 90,
            marginBottom: 16,
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {/* Label — 2x size */}
          <div
            className="chat-annotation-text"
            style={{
              fontFamily: "'Segoe UI', system-ui, sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "#38bdf8",
              textShadow: "0 0 28px rgba(56,189,248,0.5)",
              whiteSpace: "nowrap",
              letterSpacing: "0.01em",
              lineHeight: 1.35,
              textAlign: "right",
            }}
          >
            Chat with Alex-IO —<br />get a quote in minutes
          </div>

          {/* Hand-drawn SVG arrow — 2x size */}
          <svg
            width="128"
            height="96"
            viewBox="0 0 64 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 0 10px rgba(56,189,248,0.45))" }}
          >
            {/* Sketchy curved arrow shaft */}
            <path
              d="M 8 4 C 12 8, 18 14, 22 22 C 26 30, 30 36, 36 42"
              stroke="#38bdf8"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
              opacity="0.9"
            />
            {/* Second pass — slight offset for hand-drawn feel */}
            <path
              d="M 9 5 C 13 9, 19 15, 23 23 C 27 31, 31 37, 37 43"
              stroke="#38bdf8"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
              opacity="0.4"
            />
            {/* Arrowhead — hand-drawn, slightly off-angle */}
            <path
              d="M 36 42 L 28 38 M 36 42 L 40 34"
              stroke="#38bdf8"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
              opacity="0.9"
            />
            {/* Arrowhead second pass */}
            <path
              d="M 37 43 L 29 39 M 37 43 L 41 35"
              stroke="#38bdf8"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
              opacity="0.4"
            />
          </svg>
        </div>
      )}

      {/* Bubble button */}
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); setMinimizedHint(true); }}
          className="group flex items-center gap-2 sm:gap-3 rounded-full border border-white/15 bg-slate-950/80 px-3 sm:px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur hover:bg-slate-950/90"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/20 ring-1 ring-sky-300/20">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
          </span>
          <span className="leading-tight">
            <span className="block">Talk to Alex-IO</span>
            <span className="block text-[11px] font-medium text-slate-300">
              chat → layout → pricing
            </span>
          </span>
          <span className="ml-1 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-200">
            Live
          </span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="w-[calc(100vw-24px)] max-w-[360px] overflow-hidden rounded-2xl border border-white/12 bg-slate-950/85 shadow-[0_18px_70px_rgba(0,0,0,0.65)] backdrop-blur">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <div className="text-xs font-semibold tracking-widest text-sky-300/80">ALEX-IO</div>
              <div className="mt-0.5 text-[11px] text-slate-300">
                Chat your way into a real quote.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={listRef} className="max-h-[480px] overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              {msgs.map((m) => (
                <div
                  key={m.id}
                  className={["flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-sky-500/25 text-white ring-1 ring-sky-300/20"
                        : "bg-white/[0.05] text-slate-200 ring-1 ring-white/10",
                    ].join(" ")}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick replies — only shown when not done, mirrors SplashChatWidget */}
            {!done && quickReplies.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {quickReplies.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void handleSend(q)}
                    disabled={busy}
                    className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Done card — only shown when AI confirms done=true (mirrors SplashChatWidget) */}
            {done && (
              <div ref={doneCardRef} className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                  QUICK SUMMARY
                </div>
                <ul className="mt-2 space-y-1 text-sm text-slate-200">
                  {summaryLines.map((l) => (
                    <li key={l}>• {l}</li>
                  ))}
                </ul>

                {seedError && (
                  <div className="mt-2 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                    Something went wrong — please try again.
                  </div>
                )}

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => void openDemo()}
                    disabled={seeding}
                    className="w-full rounded-full bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white ring-1 ring-sky-300/20 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {seeding ? "Setting up your quote…" : "Open layout & pricing"}
                  </button>
                </div>

                <div className="mt-2 text-[11px] text-slate-400">
                  You can keep chatting to add or correct anything — I'll update the
                  summary. Open the layout when you're ready.
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/10 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) {
                      const t = input;
                      setInput("");
                      void handleSend(t);
                    }
                  }
                }}
                rows={1}
                placeholder={done ? "Add anything else…" : "Type here…"}
                className="min-h-[42px] flex-1 resize-none rounded-2xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <button
                type="button"
                onClick={() => {
                  if (!busy && input.trim()) {
                    const t = input;
                    setInput("");
                    void handleSend(t);
                  }
                }}
                disabled={busy || !input.trim()}
                className="rounded-2xl bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white ring-1 ring-sky-300/20 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send
              </button>
            </div>

            {minimizedHint && (
              <div className="mt-2 text-[11px] text-slate-400">
                Press <span className="text-slate-300">Esc</span> to close.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}