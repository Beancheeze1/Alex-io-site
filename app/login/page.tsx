// app/login/page.tsx
"use client";

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If middleware sent us here, it sets ?next=... and we honor it.
// If no ?next=, we land by role after login.
const next = searchParams.get("next");


  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          data?.message || "Invalid email or password. Please try again.",
        );
        setSubmitting(false);
        return;
      }

      const role = String(data?.user?.role || "").toLowerCase();

      // Role landing only when no ?next= provided.
      const fallback =
        role === "admin"
          ? "/admin"
          : role === "cs"
            ? "/admin/quotes"
            : role === "sales"
              ? "/admin/quotes"
              : "/my-quotes";

      const dest = next || fallback;

      router.push(dest);
      router.refresh();

    } catch (err) {
      console.error("Login error:", err);
      setError("There was a problem logging in. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-medium text-[var(--text-primary)]">
          Sign in to Alex-IO
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--text-muted)]">
          Use your company email and password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-sm outline-none ring-0 placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-sm outline-none ring-0 placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--attention)]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {/* Optional build marker – now in the JSX where it belongs */}
        <p className="mt-4 text-center text-xs text-[var(--text-faint)]">
          Build: 2025-12-05 login-debug
        </p>
      </div>
    </div>
  );
}
