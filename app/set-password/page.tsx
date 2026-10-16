// app/set-password/page.tsx
//
// Step 36A: where invite and reset emails land (?t=<token>). Choose a
// password (POST /api/auth/set-password), then sign in.

"use client";

import * as React from "react";
import Link from "next/link";

const MIN = 10;

export default function SetPasswordPage() {
  const [token, setToken] = React.useState<string | null>(null);
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [dead, setDead] = React.useState(false);

  const [kind, setKind] = React.useState<"invite" | "reset" | null>(null);

  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") || "";
    if (!t) {
      setToken("");
      return;
    }
    // Step 36B: check the link first (read only) so an old link says so at once.
    fetch(`/api/auth/set-password?t=${encodeURIComponent(t)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok && j.valid === false) {
          setDead(true);
          setError("This link has expired or was already used. Ask for a new one.");
        }
        if (j?.kind === "invite" || j?.kind === "reset") setKind(j.kind);
      })
      .catch(() => undefined)
      .finally(() => setToken(t));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, password: pw }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        setDone(String(j.email || ""));
        return;
      }
      if (r.status === 400 && j?.error === "invalid_link") setDead(true);
      if (r.status === 410) setDead(true);
      setError(r.status === 429 ? "Too many attempts. Please wait a minute." : j?.message || "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm" data-set-password>
        <h1 className="mb-2 text-center text-xl font-medium text-[var(--text-primary)]">
          {kind === "reset" ? "Choose a new password" : "Choose your password"}
        </h1>
        {done !== null ? (
          <div className="text-center text-sm text-[var(--text-secondary)]" data-set-password-done>
            <p className="mb-4">Your password is set{done ? ` for ${done}` : ""}.</p>
            <Link href="/login" className="inline-flex rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white">
              Sign in
            </Link>
          </div>
        ) : token === null ? null : !token || dead ? (
          <div className="text-center text-sm text-[var(--text-secondary)]" data-set-password-dead>
            <p className="mb-4">{error || "This link is missing its code."}</p>
            <Link href="/forgot-password" className="underline">
              Get a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-center text-sm text-[var(--text-muted)]">At least {MIN} characters.</p>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              New password
              <input type="password" autoComplete="new-password" className={`mt-1 ${input}`} value={pw} onChange={(e) => setPw(e.target.value)} data-pw />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Type it again
              <input type="password" autoComplete="new-password" className={`mt-1 ${input}`} value={pw2} onChange={(e) => setPw2(e.target.value)} data-pw2 />
            </label>
            {error ? (
              <p className="text-xs text-[var(--attention)]" role="alert" data-set-password-error>
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || !pw || !pw2}
              className="flex w-full items-center justify-center rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              data-set-password-submit
            >
              {busy ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
