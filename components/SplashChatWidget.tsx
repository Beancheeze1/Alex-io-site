// components/SplashChatWidget.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type WidgetFacts = {
  // core
  outsideL?: string;
  outsideW?: string;
  outsideH?: string;
  qty?: string;

  // shipping + fit intent
  shipMode?: "box" | "mailer" | "unsure";

  // build intent / layers
  insertType?: "single" | "set" | "unsure"; // set = base + top pad/lid
  pocketsOn?: "base" | "top" | "both" | "unsure";

  // NEW: layers (structured)
  // Convention: Layer 1 = base/body, higher layers stack upward (top pad/lid is last layer).
  layerCount?: "1" | "2" | "3" | "4";
  layerThicknesses?: string[]; // e.g. ["3","1"]

  // holding
  holding?: "pockets" | "loose" | "unsure";
  pocketCount?: "1" | "2" | "3+" | "unsure";

  // material
  materialMode?: "recommend" | "known";
  materialText?: string;

  // notes (freeform)
  notes?: string;

  // meta
  createdAtIso?: string;
};

type Msg = {
  id: string;
  role: "bot" | "user";
  text: string;
};

const LS_KEY = "alexio_splash_widget_v2"; // bump to avoid old step-state collisions

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
    shipMode: facts.shipMode ?? "",
    insertType: facts.insertType ?? "",
    pocketsOn: facts.pocketsOn ?? "",
    holding: facts.holding ?? "",
    pocketCount: facts.pocketCount ?? "",
    material: {
      mode: facts.materialMode ?? "",
      text: facts.materialText ?? "",
    },

    // NEW: layers (structured)
    layerCount: facts.layerCount ?? "",
    layerThicknesses: Array.isArray(facts.layerThicknesses) ? facts.layerThicknesses : [],

    notes: facts.notes ?? "",
  };
}

function summarizeFacts(facts: WidgetFacts) {
  const dims =
    facts.outsideL && facts.outsideW && facts.outsideH
      ? `${facts.outsideL}×${facts.outsideW}×${facts.outsideH} in`
      : "(size not set)";

  const qty = facts.qty ? `${facts.qty}` : "(qty not set)";

  const ship =
    facts.shipMode === "box"
      ? "Box"
      : facts.shipMode === "mailer"
        ? "Mailer"
        : facts.shipMode === "unsure"
          ? "Not sure"
          : "(shipping not set)";

  const insert =
    facts.insertType === "single"
      ? "Single insert"
      : facts.insertType === "set"
        ? `Set (base + top pad${facts.pocketsOn ? `; pockets: ${facts.pocketsOn}` : ""})`
        : facts.insertType === "unsure"
          ? "Not sure"
          : "(insert type not set)";

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
    `Shipping: ${ship}`,
    `Insert: ${insert}`,
    `Holding: ${holding}`,
    `Material: ${material}`,
    facts.notes?.trim() ? `Notes: ${facts.notes.trim()}` : null,
  ].filter(Boolean) as string[];
}

type ChatResponse = {
  assistantMessage: string;
  facts: Partial<WidgetFacts>;
  done: boolean;
  quickReplies?: string[];
};

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
        text:
          "Hey — I can do this fast. Tell me what you’re making and whatever you already know. " +
          "I’ll ask the *next best* question and then open the layout + pricing.",
      },
      {
        id: uid("m"),
        role: "bot",
        text: "Start with outside foam size if you have it (L×W×H, inches).",
      },
    ];
  });

  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // “done” = the brain says we have enough to open /start-quote
  const [done, setDone] = React.useState<boolean>(() => {
    const saved = safeJsonParse<{ done: boolean }>(localStorage.getItem(LS_KEY));
    return saved?.done ?? false;
  });

  const [quickReplies, setQuickReplies] = React.useState<string[]>(() => {
    const saved = safeJsonParse<{ quickReplies: string[] }>(localStorage.getItem(LS_KEY));
    return saved?.quickReplies ?? [];
  });

  const listRef = React.useRef<HTMLDivElement | null>(null);

  // NEW: lets Enter key submit via the existing <form onSubmit> path
  const formRef = React.useRef<HTMLFormElement | null>(null);

  // Persist
  React.useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          facts,
          msgs,
          done,
          quickReplies,
        })
      );
    } catch {
      // ignore
    }
  }, [facts, msgs, done, quickReplies]);

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
        text:
          "Alright — fresh start. Tell me what you’re making and what you know so far. " +
          "If you’ve got outside size + qty, even better.",
      },
    ]);
    setDone(false);
    setQuickReplies([]);
    setInput("");
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }

  async function callBrain(userText: string) {
    const res = await fetch(`/api/widget/chat?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        messages: msgs.map((m) => ({ role: m.role, text: m.text })),
        userText,
        facts,
      }),
    });

    if (!res.ok) {
      throw new Error(`brain_http_${res.status}`);
    }

    const data = (await res.json()) as ChatResponse;
    if (!data || typeof data.assistantMessage !== "string") {
      throw new Error("brain_bad_payload");
    }
    return data;
  }

  async function handleSend(text: string) {
    const t = text.trim();
    if (!t) return;

    setBusy(true);
    pushUser(t);

    try {
      const data = await callBrain(t);

      // Apply fact updates (additive)
      if (data.facts && typeof data.facts === "object") {
        setFacts((prev) => ({ ...prev, ...data.facts }));
      }

      // Bot message
      pushBot(data.assistantMessage);

      // done + quick replies
      setDone(Boolean(data.done));
      setQuickReplies(Array.isArray(data.quickReplies) ? data.quickReplies.slice(0, 6) : []);
    } catch {
      // Fallback (still conversational)
      pushBot(
        "I’m with you — quick hiccup on my side. Try that again, or just give me outside size (L×W×H) and qty."
      );
    } finally {
      setBusy(false);
    }
  }

  function openStartQuote() {
    // Add a little “shipping fit” note automatically when box/mailer selected
    // (This is just notes text; /start-quote already displays the fit hint.)
    const payloadFacts: WidgetFacts = { ...facts };
    const noteBits: string[] = [];

    if (payloadFacts.shipMode === "box" || payloadFacts.shipMode === "mailer") {
      noteBits.push('Fit: For box/mailer, undersize foam L/W by 0.125" for drop-in fit.');
    }
    if (payloadFacts.insertType === "set") {
      noteBits.push("Insert: Set (base + top pad/lid).");
      if (payloadFacts.pocketsOn && payloadFacts.pocketsOn !== "unsure") {
        noteBits.push(`Pockets on: ${payloadFacts.pocketsOn}.`);
      }
    }
    if (noteBits.length) {
      const existing = (payloadFacts.notes ?? "").trim();
      payloadFacts.notes = existing ? `${existing}\n${noteBits.join("\n")}` : noteBits.join("\n");
    }

    const payload = buildPrefillPayload(payloadFacts);
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

        {open && (
          <div className="w-[360px] overflow-hidden rounded-2xl border border-white/12 bg-slate-950/85 shadow-[0_18px_70px_rgba(0,0,0,0.65)] backdrop-blur">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                  ALEX-IO
                </div>
                <div className="mt-0.5 text-[11px] text-slate-300">
                  Talk to me like a human. I’ll keep it tight.
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
            <div ref={listRef} className="max-h-[380px] overflow-y-auto px-4 py-3">
              <div className="space-y-3">
                {msgs.map((m) => (
                  <div
                    key={m.id}
                    className={["flex", m.role === "user" ? "justify-end" : "justify-start"].join(
                      " "
                    )}
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

              {/* Quick replies */}
              {!done && quickReplies.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickReplies.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        void handleSend(q);
                      }}
                      className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/[0.08]"
                      disabled={busy}
                      title={q}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Done card */}
              {done ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                    QUICK SUMMARY
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
                      Open layout & pricing
                    </button>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-400">
                    Opens the seeded editor via{" "}
                    <code className="text-slate-300">{startQuotePath}</code>.
                  </div>
                </div>
              ) : null}
            </div>

            {/* Input */}
            <div className="border-t border-white/10 p-3">
              <form
                ref={formRef}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy || done) return;
                  const t = input;
                  setInput("");
                  void handleSend(t);
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter makes a newline.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      // Let the form onSubmit logic decide if it's allowed (busy/done/input)
                      formRef.current?.requestSubmit();
                    }
                  }}
                  rows={1}
                  placeholder={done ? "Reset to start a new quote" : "Type here…"}
                  disabled={done}
                  className="min-h-[42px] flex-1 resize-none rounded-2xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={busy || done || !input.trim()}
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
