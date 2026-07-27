// components/embed/EmbedChatClient.tsx
//
// Client-side state machine for /embed/chat: closed bubble -> open panel ->
// expanded quote form, all within the SAME iframe (no page navigation).
//
// closed/open are small, fixed, corner-anchored sizes owned by embed.js on
// the host page. "expanded" is a big, near-viewport-filling modal (embed.js
// sizes the outer iframe to viewport minus a comfortable margin) — same
// widget the standalone /start-quote page already shows (backdrop + centered
// card + its own Close button, i.e. StartQuoteModal WITHOUT the `embedded`
// prop), just presented inside the chat iframe instead of a page navigation.
// Not the placeholder-div form/viewer embeds' "grow to fit total content"
// model either: a multi-step wizard can be taller than the modal's own
// capped height, so it scrolls internally (same as the real /start-quote
// page always has) — no EmbedResizeReporter/dynamic height tracking here.
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
    // Deliberately NOT `embedded` — this is the same backdrop + centered
    // card + Close button treatment /start-quote always uses. onClose
    // overrides the default router-based close (which would try to
    // navigate to /admin, a staff route, or app history that doesn't
    // exist inside this iframe) to just minimize back to the chat bubble.
    return (
      <StartQuoteModal onClose={() => setState("closed")} initialPrefillData={prefillPayload} />
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
