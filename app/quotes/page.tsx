// app/quotes/page.tsx
//
// "My Quotes" landing page.
// - Shows quotes where sales_rep_id = current user's id.
// - Uses /api/my-quotes (read-only).
// - Links to /quote?quote_no=... for the full quote view.

"use client";

import * as React from "react";
import Link from "next/link";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
};

type ApiResponse = {
  ok: boolean;
  quotes?: QuoteRow[];
  error?: string;
};

export default function MyQuotesPage() {
  const [quotes, setQuotes] = React.useState<QuoteRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadQuotes() {
      try {
        setLoading(true);
        const res = await fetch("/api/my-quotes?limit=100", {
          cache: "no-store",
        });

        if (res.status === 401) {
          // Just in case the layout didn't already redirect.
          window.location.href = "/login?next=/quotes";
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json: ApiResponse = await res.json();
        if (!active) return;

        if (!json.ok) {
          throw new Error(json.error || "my-quotes API returned ok=false.");
        }

        setQuotes(json.quotes || []);
        setError(null);
      } catch (err) {
        console.error("Failed to load my quotes:", err);
        if (active) {
          setError("Could not load your quotes. Please try again.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadQuotes();

    return () => {
      active = false;
    };
  }, []);

  const hasQuotes = quotes && quotes.length > 0;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              My quotes
            </h1>
            <p className="mt-2 text-sm text-neutral-300">
              Quotes that have been assigned to your seat. Older quotes that
              don&apos;t have a sales rep set yet will not appear here.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
          >
            Back to admin
          </Link>
        </header>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-md">
          {!hasQuotes && !loading && !error && (
            <div className="py-6 text-center text-sm text-neutral-300">
              <p className="mb-2">You don&apos;t have any quotes yet.</p>
              <p className="text-xs text-neutral-400">
                Once new quotes are created and assigned to your seat, they&apos;ll
                appear here automatically.
              </p>
            </div>
          )}

          {loading && (
            <p className="text-sm text-neutral-300">Loading your quotes…</p>
          )}

          {error && !loading && (
            <p className="text-sm text-rose-300">{error}</p>
          )}

          {hasQuotes && !loading && (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-neutral-800 text-neutral-400">
                  <tr>
                    <th className="py-2 pr-4">Quote #</th>
                    <th className="py-2 pr-4">Customer</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr
                      key={q.id}
                      className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/70"
                    >
                      <td className="py-2 pr-4 text-neutral-50">
                        {q.quote_no}
                      </td>
                      <td className="py-2 pr-4 text-neutral-200">
                        {q.customer_name || "—"}
                      </td>
                      <td className="py-2 pr-4 text-neutral-300">
                        {q.status || "—"}
                      </td>
                      <td className="py-2 pr-4 text-neutral-400">
                        {new Date(q.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-0 text-right">
                        <Link
                          href={`/quote?quote_no=${encodeURIComponent(
                            q.quote_no,
                          )}`}
                          className="text-xs text-sky-300 hover:text-sky-200 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
