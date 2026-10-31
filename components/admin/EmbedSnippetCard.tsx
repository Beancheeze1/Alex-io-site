// components/admin/EmbedSnippetCard.tsx
//
// Step 38D: the embed snippet generator, moved unchanged from the admin
// Home to Shop settings → Website & chat widget (/admin/website).

"use client";

import * as React from "react";
import { buildEmbedHost } from "@/lib/embed-host";

type EmbedMode = "quote-form" | "quote-viewer" | "chat";

function buildEmbedSnippet(slug: string, mode: EmbedMode): string {
  if (mode === "chat") {
    // No placeholder div — chat floats independent of document flow,
    // corner-pinned by embed.js itself. Tenant comes from the script tag's
    // own data-tenant attribute.
    return `<script src="https://api.alex-io.com/embed.js" data-alexio-chat data-tenant="${slug}" async></script>`;
  }

  const dataAttrs =
    mode === "quote-viewer"
      ? `data-alexio-embed data-tenant="${slug}" data-mode="quote-viewer" data-quote-no="PASTE-QUOTE-NUMBER-HERE"`
      : `data-alexio-embed data-tenant="${slug}" data-mode="quote-form"`;

  return [
    `<div ${dataAttrs}></div>`,
    `<script src="https://api.alex-io.com/embed.js" async></script>`,
  ].join("\n");
}

export default function EmbedSnippetCard({
  tenantSlug,
  landingChatEnabled,
}: {
  tenantSlug: string | null;
  landingChatEnabled: boolean;
}) {
  const [mode, setMode] = React.useState<EmbedMode>("quote-form");
  const [copied, setCopied] = React.useState(false);

  const snippet = tenantSlug ? buildEmbedSnippet(tenantSlug, mode) : "";

  async function handleCopy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Embed snippet
        </div>
        {tenantSlug && (
          <span className="inline-flex items-center rounded-full bg-[var(--status-neutral-bg)] px-2 py-0.5 text-[10px] text-[var(--status-neutral-text)]">
            {buildEmbedHost(tenantSlug)}
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        Paste this snippet into any page on your own website to embed the quote form or
        interactive quote viewer inline.
      </p>

      {!tenantSlug ? (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Could not resolve your tenant — reload this page to try again.
        </p>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("quote-form")}
              className={[
                "rounded-full px-3 py-1 text-[11px] font-medium",
                mode === "quote-form"
                  ? "bg-[var(--action-primary)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              Quote form
            </button>
            <button
              type="button"
              onClick={() => setMode("quote-viewer")}
              className={[
                "rounded-full px-3 py-1 text-[11px] font-medium",
                mode === "quote-viewer"
                  ? "bg-[var(--action-primary)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              Quote viewer
            </button>
            <button
              type="button"
              onClick={() => landingChatEnabled && setMode("chat")}
              disabled={!landingChatEnabled}
              title={landingChatEnabled ? undefined : "Turn on the chat widget first (Shop settings → Shop page)."}
              className={[
                "rounded-full px-3 py-1 text-[11px] font-medium",
                !landingChatEnabled
                  ? "cursor-not-allowed border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-faint)] opacity-60"
                  : mode === "chat"
                    ? "bg-[var(--action-primary)] text-white"
                    : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              Chat
            </button>
          </div>

          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--border)] bg-[var(--surface-page)] p-3 text-[11px] leading-relaxed text-[var(--text-primary)]">
            {snippet}
          </pre>

          {mode === "quote-viewer" && (
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Replace <code>PASTE-QUOTE-NUMBER-HERE</code> with the real quote number you want to
              display (e.g. from a customer&apos;s emailed quote link).
            </p>
          )}

          {mode === "chat" && landingChatEnabled && (
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              No placeholder div needed — this floats as a corner bubble on your site and expands
              into the quote form itself once a visitor finishes the guided chat.
            </p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center rounded-full bg-[var(--action-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--action-primary-hover)]"
            >
              Copy to clipboard
            </button>
            {copied && (
              <span className="text-[11px] text-[var(--status-success-text)]">Copied!</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
