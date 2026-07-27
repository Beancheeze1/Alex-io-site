// components/embed/EmbedChatClient.tsx
//
// Client-side state machine for /embed/chat: closed bubble -> open panel ->
// expanded quote form, all within the SAME iframe (no page navigation).
//
// Distinct from the form/viewer embeds' "grow to fit total content" model:
// closed/open are fixed, known sizes owned by embed.js on the host page;
// only the expanded phase (the actual quote form) behaves like form/viewer
// and reports its real content height via EmbedResizeReporter.
//
// Message contract with embed.js:
//   { type: "alex-io-chat-state", state: "closed" | "open" | "expanded" | "disabled" }
//   { type: "alex-io-resize", height } — only while expanded (from EmbedResizeReporter)

"use client";

import * as React from "react";
import SplashChatWidget from "@/components/SplashChatWidget";
import StartQuoteModal from "@/components/start-quote/StartQuoteModal";
import EmbedResizeReporter from "@/components/embed/EmbedResizeReporter";

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
      <EmbedResizeReporter>
        <StartQuoteModal embedded initialPrefillData={prefillPayload} />
      </EmbedResizeReporter>
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
