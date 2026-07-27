// components/embed/EmbedResizeReporter.tsx
//
// Wraps an /embed/* page's content and reports the page's real rendered
// height to the parent window (via postMessage) on mount and on any
// subsequent height change — new layers, toggled options, validation
// errors, expanded sections, anything. A ResizeObserver on document.body
// picks up all of these generically, so embed.js (running on the host
// page) can resize the iframe to match without us tracking a hardcoded
// list of "things that change height".
//
// Message shape is a fixed, versioned-by-convention contract with
// embed.js: { type: "alex-io-resize", height: <px> }.

"use client";

import * as React from "react";

const RESIZE_MESSAGE_TYPE = "alex-io-resize";

function reportHeight() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.parent === window) return; // not actually embedded — no-op

  const height = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  );

  window.parent.postMessage({ type: RESIZE_MESSAGE_TYPE, height }, "*");
}

export default function EmbedResizeReporter({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // Report once immediately, and again after the first paint/layout
    // settles (fonts, images, and client-side data fetches can still be
    // in flight right at mount).
    reportHeight();
    const raf = requestAnimationFrame(reportHeight);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => reportHeight());
      observer.observe(document.body);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, []);

  return <>{children}</>;
}
