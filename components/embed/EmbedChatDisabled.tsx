// components/embed/EmbedChatDisabled.tsx
//
// Rendered by /embed/chat when the resolved tenant hasn't opted into chat
// (theme_json.landingChatEnabled is not true). Posts a "disabled" chat
// state so embed.js removes/hides the iframe entirely — pasting the chat
// snippet for a tenant that hasn't opted in must render nothing, not an
// empty-but-visible box.

"use client";

import * as React from "react";

export default function EmbedChatDisabled() {
  React.useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage({ type: "alex-io-chat-state", state: "disabled" }, "*");
  }, []);

  return null;
}
