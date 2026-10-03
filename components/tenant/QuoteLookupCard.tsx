// components/tenant/QuoteLookupCard.tsx
//
// "Look up a quote" card on the tenant Quotes & ordering page.
// Posts quote number + email to /api/public/quote-lookup and, on a match,
// navigates to the quote. Errors use the design system's attention color.
"use client";

import * as React from "react";

export default function QuoteLookupCard({
  tenantSlug,
  primaryColor,
  onPrimary,
}: {
  tenantSlug: string;
  primaryColor: string;
  onPrimary: string;
}) {
  const [quoteNo, setQuoteNo] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/public/quote-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: tenantSlug, quote_no: quoteNo, email }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && typeof data.url === "string" && data.url.startsWith("/quote?")) {
        window.location.assign(data.url);
        return;
      }
      setError(
        res.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : typeof data?.message === "string"
            ? data.message
            : "We couldn't open that quote. Please try again.",
      );
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--border-strong)",
    background: "var(--surface-page)",
    color: "var(--text-primary)",
  };

  return (
    <div
      className="flex flex-col rounded-xl p-7 shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
    >
      <h2 className="mb-2 text-xl font-medium">Look up a quote</h2>
      <p className="mb-4" style={{ color: "var(--text-secondary)" }}>
        Have a quote number? Enter it with the email the quote was sent to.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2.5" noValidate>
        <label className="text-sm" style={{ color: "var(--text-muted)" }}>
          Quote number
          <input
            type="text"
            autoComplete="off"
            value={quoteNo}
            onChange={(e) => setQuoteNo(e.target.value)}
            className="mt-1 block w-full rounded-md px-3 py-2.5 text-[15px]"
            style={inputStyle}
          />
        </label>
        <label className="text-sm" style={{ color: "var(--text-muted)" }}>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md px-3 py-2.5 text-[15px]"
            style={inputStyle}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm" style={{ color: "var(--attention)" }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !quoteNo.trim() || !email.trim()}
          className="mt-1 inline-flex min-h-[48px] items-center justify-center self-start rounded-md px-5 text-[15px] font-medium disabled:opacity-50"
          style={{ background: primaryColor, color: onPrimary }}
        >
          {busy ? "Opening…" : "Open quote"}
        </button>
      </form>
    </div>
  );
}
