// app/forgot-password/page.tsx
//
// Step 36A: "Forgot password?" (POST /api/auth/forgot). The same answer
// whether or not the email has an account here.

"use client";

import * as React from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => null);
      setMsg(
        r.ok && j?.ok
          ? { ok: true, text: String(j.message) }
          : { ok: false, text: r.status === 429 ? "Too many attempts. Please wait a minute." : j?.message || "Something went wrong." },
      );
    } catch {
      setMsg({ ok: false, text: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm" data-forgot>
        <h1 className="mb-2 text-center text-xl font-medium text-[var(--text-primary)]">Forgot your password?</h1>
        <p className="mb-6 text-center text-sm text-[var(--text-muted)]">We&apos;ll email you a link to choose a new one.</p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-xs font-medium text-[var(--text-secondary)]">
            Email
            <input
              type="email"
              autoComplete="email"
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-forgot-email
            />
          </label>
          {msg ? (
            <p className={`text-xs ${msg.ok ? "text-[var(--text-primary)]" : "text-[var(--attention)]"}`} role={msg.ok ? "status" : "alert"} data-forgot-msg>
              {msg.text}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="flex w-full items-center justify-center rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            data-forgot-submit
          >
            {busy ? "Sending…" : "Email me a link"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs">
          <Link href="/login" className="text-[var(--text-muted)] underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
