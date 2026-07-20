import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  created_at: string;
};

type QuoteRow = {
  id: number;
  quote_no: string;
  status: string | null;
  locked: boolean | null;
  created_at: string;
  updated_at: string;
};

function fmtDate(raw: string): string {
  try {
    const d = new Date(raw);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return raw;
  }
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserFromCookies();
  if (!user || user.role !== "admin") redirect("/login");

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    redirect("/admin/quotes");
  }

  const customer = (await one<CustomerRow>(
    `select id, name, email, phone, company, created_at
     from public.customers
     where id = $1 and tenant_id = $2`,
    [customerId, user.tenant_id],
  )) as CustomerRow | null;

  if (!customer) {
    redirect("/admin/quotes");
  }

  const quotes = (await q<QuoteRow>(
    `select id, quote_no, status, locked, created_at, updated_at
     from public."quotes"
     where customer_id = $1 and tenant_id = $2
     order by created_at desc`,
    [customerId, user.tenant_id],
  )) as QuoteRow[];

  const quotesWithRevision = await Promise.all(
    quotes.map(async (row) => {
      let revision: string | null = null;
      try {
        const facts = await loadFacts(row.quote_no);
        revision = (facts as any)?.revision ?? (facts as any)?.stage_rev ?? null;
      } catch {
        revision = null;
      }
      return { ...row, revision };
    }),
  );

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)] p-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/admin/quotes" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          ← Back to quotes
        </Link>

        <div className="mt-3 mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
          <div className="text-lg font-medium">{customer!.name || "Unnamed customer"}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
            {customer!.email ? <span>{customer!.email}</span> : null}
            {customer!.phone ? <span>{customer!.phone}</span> : null}
            {customer!.company ? <span>{customer!.company}</span> : null}
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            Customer since {fmtDate(customer!.created_at)}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-subtle)]">
            <div className="text-sm font-medium">
              {quotesWithRevision.length} quote{quotesWithRevision.length === 1 ? "" : "s"}
            </div>
          </div>

          {quotesWithRevision.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
              No quotes on file for this customer yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-5 py-2 font-medium">Quote</th>
                  <th className="px-5 py-2 font-medium">Revision</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {quotesWithRevision.map((q) => (
                  <tr key={q.id} className="border-t border-[var(--border)]">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/quotes/${encodeURIComponent(q.quote_no)}`}
                        className="font-medium text-[var(--text-primary)] hover:underline"
                      >
                        {q.quote_no}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      {q.revision ? (
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-0.5 text-xs font-medium">
                          {q.revision}
                        </span>
                      ) : (
                        <span className="text-[var(--text-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">
                      {q.locked ? "Released for mfg" : q.status || "Draft"}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)]">{fmtDate(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
