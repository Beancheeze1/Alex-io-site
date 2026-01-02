// components/SplashChatWidget.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type WidgetFacts = {
  // core
  outsideL?: string; // keep as string for now (user may type "12" or "12.5")
  outsideW?: string;
  outsideH?: string;
  qty?: string;

  // holding
  holding?: "pockets" | "loose" | "unsure";
  pocketCount?: "1" | "2" | "3+" | "unsure";

  // material
  materialMode?: "recommend" | "known";
  materialText?: string; // "EPE 1.7#", "PU", etc.

  // notes
  notes?: string;

  // meta for future
  createdAtIso?: string;
};

type Msg = {
  id: string;
  role: "bot" | "user";
  text: string;
};

const LS_KEY = "alexio_splash_widget_v1";

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function buildPrefillPayload(facts: WidgetFacts) {
  // Keep this conservative and additive.
  // We will wire /start-quote to consume this in the next step.
  return {
    source: "splash-widget",
    createdAtIso: facts.createdAtIso ?? new Date().toISOString(),
    outside: {
      l: facts.outsideL ?? "",
      w: facts.outsideW ?? "",
      h: facts.outsideH ?? "",
      units: "in",
    },
    qty: facts.qty ?? "",
    holding: facts.holding ?? "",
    pocketCount: facts.pocketCount ?? "",
    material: {
      mode: facts.materialMode ?? "",
      text: facts.materialText ?? "",
    },
    notes: facts.notes ?? "",
  };
}

function summarizeFacts(facts: WidgetFacts) {
  const dims =
    facts.outsideL && facts.outsideW && facts.outsideH
      ? `${facts.outsideL}×${facts.outsideW}×${facts.outsideH} in`
      : "(size not set)";

  const qty = facts.qty ? `${facts.qty}` : "(qty not set)";

  const holding =
    facts.holding === "pockets"
      ? `Cut-out pockets (${facts.pocketCount ?? "?"})`
      : facts.holding === "loose"
        ? "Loose / no pockets"
        : facts.holding === "unsure"
          ? "Not sure yet"
          : "(holding not set)";

  const material =
    facts.materialMode === "known"
      ? facts.materialText?.trim() || "(material not set)"
      : facts.materialMode === "recommend"
        ? "Recommended"
        : "(material not set)";

  return [
    `Outside size: ${dims}`,
    `Quantity: ${qty}`,
    `Holding: ${holding}`,
    `Material: ${material}`,
    facts.notes?.trim() ? `Notes: ${facts.notes.trim()}` : null,
  ].filter(Boolean) as string[];
}

type Step =
  | "intro"
  | "ask_dims"
  | "ask_qty"
  | "ask_holding"
  | "ask_pocket_count"
  | "ask_material_mode"
  | "ask_material_text"
  | "ask_notes"
  | "done";

export default function SplashChatWidget({
  startQuotePath,
}: {
  startQuotePath: string;
}) {
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [minimizedHint, setMinimizedHint] = React.useState(false);

  const [facts, setFacts] = React.useState<WidgetFacts>(() => {
    const saved = safeJsonParse<{ facts: WidgetFacts }>(localStorage.getItem(LS_KEY));
    if (saved?.facts) return saved.facts;
    return { createdAtIso: new Date().toISOString() };
  });

  const [msgs, setMsgs] = React.useState<Msg[]>(() => {
    const saved = safeJsonParse<{ msgs: Msg[] }>(localStorage.getItem(LS_KEY));
    if (saved?.msgs?.length) return saved.msgs;
    return [
      {
        id: uid("m"),
        role: "bot",
        text: "Hi — I can help you get a fast, accurate quote. No forms. I’ll ask just what’s needed.",
      },
      {
        id: uid("m"),
        role: "bot",
        text: "To start: what’s the outside size (L×W×H) in inches?",
      },
    ];
  });

  const [step, setStep] = React.useState<Step>(() => {
    const saved = safeJsonParse<{ step: Step }>(localStorage.getItem(LS_KEY));
    return saved?.step ?? "ask_dims";
  });

  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Persist state (safe + additive)
  React.useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          facts,
          msgs,
          step,
        })
      );
    } catch {
      // ignore
    }
  }, [facts, msgs, step]);

  // Auto scroll
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, msgs.length]);

  // Close on escape
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pushBot(text: string) {
    setMsgs((m) => [...m, { id: uid("m"), role: "bot", text }]);
  }

  function pushUser(text: string) {
    setMsgs((m) => [...m, { id: uid("m"), role: "user", text }]);
  }

  function reset() {
    const freshFacts: WidgetFacts = { createdAtIso: new Date().toISOString() };
    setFacts(freshFacts);
    setMsgs([
      {
        id: uid("m"),
        role: "bot",
        text: "Hi — I can help you get a fast, accurate quote. No forms. I’ll ask just what’s needed.",
      },
      {
        id: uid("m"),
        role: "bot",
        text: "To start: what’s the outside size (L×W×H) in inches?",
      },
    ]);
    setStep("ask_dims");
    setInput("");
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }

  function parseDims(raw: string): { l?: string; w?: string; h?: string } {
    // Accept forms like "12x8x3", "12 x 8 x 3", "12×8×3"
    const s = raw.trim().toLowerCase().replaceAll("×", "x");
    const parts = s
      .split("x")
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length >= 3) {
      const l = parts[0].replace(/[^\d.]/g, "");
      const w = parts[1].replace(/[^\d.]/g, "");
      const h = parts[2].replace(/[^\d.]/g, "");
      return { l: l || undefined, w: w || undefined, h: h || undefined };
    }
    return {};
  }

  async function handleSend(text: string) {
    if (!text.trim()) return;

    setBusy(true);
    pushUser(text);

    // Step machine (deterministic)
    const t = text.trim();

    try {
      if (step === "ask_dims") {
        const d = parseDims(t);
        if (!d.l || !d.w || !d.h) {
          pushBot("Quick check: please enter outside size as L×W×H (example: 18x12x3).");
          setBusy(false);
          return;
        }
        setFacts((f) => ({ ...f, outsideL: d.l, outsideW: d.w, outsideH: d.h }));
        pushBot(`Got it — outside size ${d.l}×${d.w}×${d.h} in.`);
        pushBot("What quantity should we quote? (an estimate is fine)");
        setStep("ask_qty");
        setBusy(false);
        return;
      }

      if (step === "ask_qty") {
        const q = t.replace(/[^\d]/g, "");
        if (!q) {
          pushBot("What quantity should we quote? (example: 250)");
          setBusy(false);
          return;
        }
        setFacts((f) => ({ ...f, qty: q }));
        pushBot(`Perfect — qty ${q}.`);
        pushBot("Do the parts sit loose, or do they need cut-out pockets?");
        setStep("ask_holding");
        setBusy(false);
        return;
      }

      if (step === "ask_material_text") {
        setFacts((f) => ({ ...f, materialText: t }));
        pushBot("Thanks — noted.");
        pushBot("Anything else I should account for? (fragile, orientation, weight, etc.) You can also say “no”.");
        setStep("ask_notes");
        setBusy(false);
        return;
      }

      if (step === "ask_notes") {
        const notes = t.toLowerCase() === "no" ? "" : t;
        setFacts((f) => ({ ...f, notes }));
        pushBot("Great — that’s enough to generate a solid quote.");
        setStep("done");
        setBusy(false);
        return;
      }

      // For "done" or unknown, just keep it polite
      pushBot("If you want to start over, click “Reset”.");
      setBusy(false);
    } catch {
      pushBot("Sorry — something went wrong. You can click Reset and try again.");
      setBusy(false);
    }
  }

  function chooseHolding(v: WidgetFacts["holding"]) {
    pushUser(
      v === "pockets" ? "Cut-out pockets" : v === "loose" ? "Loose / no pockets" : "Not sure yet"
    );
    setFacts((f) => ({ ...f, holding: v }));

    if (v === "pockets") {
      pushBot("Got it — cut-out pockets.");
      pushBot("Roughly how many pockets per insert?");
      setStep("ask_pocket_count");
      return;
    }

    pushBot("Got it.");
    pushBot("Do you usually use a specific foam, or should I recommend one?");
    setStep("ask_material_mode");
  }

  function choosePocketCount(v: WidgetFacts["pocketCount"]) {
    pushUser(v === "unsure" ? "Not sure" : `${v}`);
    setFacts((f) => ({ ...f, pocketCount: v }));
    pushBot("Thanks.");
    pushBot("Do you usually use a specific foam, or should I recommend one?");
    setStep("ask_material_mode");
  }

  function chooseMaterialMode(v: WidgetFacts["materialMode"]) {
    pushUser(v === "recommend" ? "Recommend one" : "I have a material in mind");
    setFacts((f) => ({ ...f, materialMode: v }));

    if (v === "known") {
      pushBot("What material should we use? (example: EPE 1.7#, PE 2.2#, PU 1.5#)");
      setStep("ask_material_text");
      return;
    }

    pushBot("Sounds good — I’ll recommend a material based on what you shared.");
    pushBot("Anything else I should account for? (fragile, orientation, weight, etc.) You can also say “no”.");
    setStep("ask_notes");
  }

  function openStartQuote() {
    const payload = buildPrefillPayload(facts);
    const prefill = encodeURIComponent(JSON.stringify(payload));
    router.push(`${startQuotePath}?prefill=${prefill}`);
  }

  const summaryLines = React.useMemo(() => summarizeFacts(facts), [facts]);

  return (
    <>
      {/* Bubble */}
      <div className="fixed bottom-5 right-5 z-[80]">
        {!open && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setMinimizedHint(true);
            }}
            className="group flex items-center gap-3 rounded-full border border-white/15 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur hover:bg-slate-950/90"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/20 ring-1 ring-sky-300/20">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
            </span>
            <span className="leading-tight">
              <span className="block">Get a fast quote</span>
              <span className="block text-[11px] font-medium text-slate-300">
                chat → layout → pricing
              </span>
            </span>
            <span className="ml-1 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-200">
              New
            </span>
          </button>
        )}

        {open && (
          <div
            ref={panelRef}
            className="w-[340px] overflow-hidden rounded-2xl border border-white/12 bg-slate-950/85 shadow-[0_18px_70px_rgba(0,0,0,0.65)] backdrop-blur"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                  ALEX-IO QUOTE ASSISTANT
                </div>
                <div className="mt-0.5 text-[11px] text-slate-300">
                  I’ll ask only what’s needed.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
                  title="Reset"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={listRef}
              className="max-h-[360px] overflow-y-auto px-4 py-3"
            >
              <div className="space-y-3">
                {msgs.map((m) => (
                  <div
                    key={m.id}
                    className={[
                      "flex",
                      m.role === "user" ? "justify-end" : "justify-start",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
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

              {/* Inline quick buttons */}
              <div className="mt-3">
                {step === "ask_holding" && (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => chooseHolding("pockets")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      Cut-out pockets
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseHolding("loose")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      Loose / no pockets
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseHolding("unsure")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      Not sure yet
                    </button>
                  </div>
                )}

                {step === "ask_pocket_count" && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => choosePocketCount("1")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      1
                    </button>
                    <button
                      type="button"
                      onClick={() => choosePocketCount("2")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      2
                    </button>
                    <button
                      type="button"
                      onClick={() => choosePocketCount("3+")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      3+
                    </button>
                    <button
                      type="button"
                      onClick={() => choosePocketCount("unsure")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      Not sure
                    </button>
                  </div>
                )}

                {step === "ask_material_mode" && (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => chooseMaterialMode("recommend")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      Recommend one
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseMaterialMode("known")}
                      className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/[0.08]"
                    >
                      I have a material in mind
                    </button>
                  </div>
                )}

                {step === "done" && (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                      SUMMARY
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-slate-200">
                      {summaryLines.map((l) => (
                        <li key={l}>• {l}</li>
                      ))}
                    </ul>

                    <div className="mt-3 grid gap-2">
                      <button
                        type="button"
                        onClick={openStartQuote}
                        className="w-full rounded-full bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white ring-1 ring-sky-300/20 hover:bg-sky-500"
                      >
                        View layout & pricing
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          pushBot(
                            "For the reveal build, “Email me this” and “Request review” will be enabled next. (No workflow changes yet.)"
                          );
                        }}
                        className="w-full rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                      >
                        Email me this (next step)
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          pushBot(
                            "For the reveal build, “Request quick review” will be enabled next. (No workflow changes yet.)"
                          );
                        }}
                        className="w-full rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                      >
                        Request quick review (next step)
                      </button>
                    </div>

                    <div className="mt-2 text-[11px] text-slate-400">
                      This opens <code className="text-slate-300">{startQuotePath}</code> with a safe{" "}
                      <code className="text-slate-300">prefill</code> payload.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-white/10 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  const t = input;
                  setInput("");
                  void handleSend(t);
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={1}
                  placeholder={
                    step === "ask_dims"
                      ? "Example: 18x12x3"
                      : step === "ask_qty"
                        ? "Example: 250"
                        : step === "ask_material_text"
                          ? "Example: EPE 1.7#"
                          : step === "ask_notes"
                            ? "Example: fragile electronics"
                            : step === "done"
                              ? "Reset to start a new quote"
                              : "Type here…"
                  }
                  disabled={step === "done"}
                  className="min-h-[42px] flex-1 resize-none rounded-2xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={busy || step === "done" || !input.trim()}
                  className="rounded-2xl bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white ring-1 ring-sky-300/20 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Send
                </button>
              </form>

              {minimizedHint && (
                <div className="mt-2 text-[11px] text-slate-400">
                  Tip: press <span className="text-slate-300">Esc</span> to close.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
