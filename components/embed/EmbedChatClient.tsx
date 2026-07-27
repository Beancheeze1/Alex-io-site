// components/embed/EmbedChatClient.tsx
//
// Client-side state machine for /embed/chat: closed bubble -> open panel ->
// expanded quote form, all within the SAME iframe (no page navigation).
//
// closed/open are small, fixed, corner-anchored sizes owned by embed.js on
// the host page. "expanded" is a full-viewport takeover, NOT a bigger
// corner box — a multi-step quote wizard can be taller than the viewport,
// and a corner-anchored box that grows upward from bottom:20px eventually
// puts its own top edge above y=0, permanently unreachable (confirmed
// live). Full-viewport takeover scrolls natively like a real page instead,
// so there's no dynamic height tracking for this phase — EmbedResizeReporter
// is only used by the form/viewer embeds' grow-to-content model, not here.
//
// Message contract with embed.js:
//   { type: "alex-io-chat-state", state: "closed" | "open" | "expanded" | "disabled" }

"use client";

import * as React from "react";
import SplashChatWidget from "@/components/SplashChatWidget";
import StartQuoteModal from "@/components/start-quote/StartQuoteModal";

const CHAT_STATE_MESSAGE_TYPE = "alex-io-chat-state";

type ChatState = "closed" | "open" | "expanded";

function postChatState(state: ChatState) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ type: CHAT_STATE_MESSAGE_TYPE, state }, "*");
}

export default function EmbedChatClient() {
  const [state, setState] = React.useState<ChatState>("closed");
  const [prefillPayload, setPrefillPayload] = React.useState<Record<string, any> | null>(null);

  React.useEffect(() => {
    postChatState(state);
  }, [state]);

  // The root layout's <body> has an opaque bg-neutral-50 (fine for the
  // full-document form/viewer embeds) — but the bubble/panel states need a
  // transparent iframe so the host page's own background shows through
  // around the floating widget instead of a visible gray box. Only while
  // NOT expanded — the expanded quote form is a real full document again,
  // same as the form/viewer embeds, and wants its normal opaque surface.
  React.useEffect(() => {
    if (state === "expanded") return;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, [state]);

  if (state === "expanded") {
    return (
      <>
        {/* Full-viewport takeover has no other way back short of reloading
            the host page — without this, a visitor who opens the form by
            mistake (or wants to keep browsing the host site first) is stuck. */}
        <button
          type="button"
          onClick={() => setState("closed")}
          aria-label="Minimize back to chat"
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            zIndex: 1000,
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "var(--surface-card)",
            color: "var(--text-primary)",
            fontSize: 16,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
          }}
        >
          &#x2715;
        </button>
        <StartQuoteModal embedded initialPrefillData={prefillPayload} />
      </>
    );
  }

  return (
    <SplashChatWidget
      embedded
      startQuotePath="/start-quote"
      onOpenChange={(open) => setState(open ? "open" : "closed")}
      onQuoteReady={(payload) => {
        setPrefillPayload(payload);
        setState("expanded");
      }}
    />
  );
}
