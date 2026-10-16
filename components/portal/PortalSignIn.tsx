// components/portal/PortalSignIn.tsx
//
// Step 34A: the "Sign in" button the emailed link lands on
// (POST /api/portal/verify), then on to /t/[slug]/orders.
"use client";

import * as React from "react";

export default function PortalSignIn({
  tenantSlug,
  brandName,
  token,
  primaryColor,
  onPrimary,
}: {
  tenantSlug: string;
  brandName: string;
  token: string;
  primaryColor: string;
  onPrimary: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(token ? null : "This sign-in link is missing its code. Ask for a new one.");
  const [dead, setDead] = React.useState(false); // used / expired / invalid: only "Get a new link" is left
  const ordersHref = `/t/${encodeURIComponent(tenantSlug)}/orders`;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        window.location.assign(ordersHref);
        return;
      }
      if (res.status === 400 || res.status === 410) setDead(true);
      setError(
        res.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : typeof data?.message === "string"
            ? data.message
            : "We couldn't sign you in. Please ask for a new link.",
      );
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col rounded-xl p-7 shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
      data-portal-signin
    >
      <h1 className="mb-2 text-2xl font-medium">Sign in to your orders</h1>
      <p className="mb-5" style={{ color: "var(--text-secondary)" }}>
        See your quotes and orders with {brandName} on this browser.
      </p>
      {error ? (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--attention)" }} data-portal-signin-error>
          {error}{" "}
          <a href={ordersHref} className="underline">
            Get a new link
          </a>
        </p>
      ) : null}
      {token && !dead ? (
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={busy}
          className="inline-flex min-h-[48px] items-center justify-center self-start rounded-md px-5 text-[15px] font-medium disabled:opacity-50"
          style={{ background: primaryColor, color: onPrimary }}
          data-portal-signin-button
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      ) : null}
    </div>
  );
}
