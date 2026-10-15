// components/admin/BuyerLinkButton.tsx
//
// Step 21: "Copy buyer link" on the admin quote page. Copies the buyer's
// private edit link (the quote page, with the edit grant) to the clipboard.
// With just the quote number, a buyer can view the quote but not change it.

"use client";

import * as React from "react";

export default function BuyerLinkButton({ quoteNo }: { quoteNo: string }) {
  const [state, setState] = React.useState<"idle" | "busy" | "copied" | "error">("idle");
  const [fallbackUrl, setFallbackUrl] = React.useState<string | null>(null);

  async function copy() {
    setState("busy");
    setFallbackUrl(null);
    try {
      const res = await fetch(`/api/admin/quotes/edit-link?quote_no=${encodeURIComponent(quoteNo)}`, {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; quote_url?: string } | null;
      if (!res.ok || !j?.ok || !j.quote_url) throw new Error("no link");
      try {
        await navigator.clipboard.writeText(j.quote_url);
        setState("copied");
      } catch {
        // Clipboard blocked: show the link so it can be copied by hand.
        setFallbackUrl(j.quote_url);
        setState("idle");
        return;
      }
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        disabled={state === "busy"}
        title="Copies the buyer's private link. With it they can change the quote; with just the quote number they can only view it."
        style={{
          display: "inline-block",
          padding: "4px 10px",
          borderRadius: 999,
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          fontSize: 11,
          fontWeight: 600,
          cursor: state === "busy" ? "wait" : "pointer",
        }}
      >
        {state === "copied" ? "Link copied" : state === "error" ? "Couldn't copy" : "Copy buyer link"}
      </button>
      {fallbackUrl ? (
        <input
          readOnly
          value={fallbackUrl}
          onFocus={(e) => e.currentTarget.select()}
          style={{ fontSize: 11, width: 260, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 6 }}
        />
      ) : null}
    </>
  );
}
