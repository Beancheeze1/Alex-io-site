import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeadRow = {
  id: number;
  tier: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  quote_no: string | null;
  annual_mode: boolean;
  user_count: string | null;
  product_description: string | null;
  current_process: string | null;
  notes: string | null;
  lead_type: string | null;
  created_at: string;
};

function fmt(n: number) {
  return n.toLocaleString();
}

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

const TIER_BADGE_CLS = "bg-[var(--surface-subtle)] text-[var(--text-secondary)] border border-[var(--border)]";

export default async function LeadsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user || user.role !== "admin") redirect("/login");

  const leads = await q<LeadRow>(
    `SELECT id, tier, name, email, company, phone, quote_no,
            annual_mode, user_count, product_description,
            current_process, notes, lead_type, created_at
     FROM demo_leads
     ORDER BY created_at DESC
     LIMIT 500`,
  );

  const total   = leads.length;
  const pilot   = leads.filter((l) => l.tier === "Pilot").length;
  const starter = leads.filter((l) => l.tier === "Starter").length;
  const pro     = leads.filter((l) => l.tier === "Pro").length;
  const shop    = leads.filter((l) => l.tier === "Shop").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Demo Leads</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Contacts who requested access after viewing the live demo
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
          {fmt(total)} total
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Total Leads</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{fmt(total)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Pilot Interest</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{fmt(pilot)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Starter Interest</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{fmt(starter)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Pro Interest</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{fmt(pro)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Shop Interest</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{fmt(shop)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)] whitespace-nowrap">Date</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Tier</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Type</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Name</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Email</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Company</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Quote</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Billing</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Details</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[var(--text-faint)]">
                    No leads yet — they&apos;ll appear here after someone completes a demo and requests access
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const hasDetails =
                    lead.user_count ||
                    lead.product_description ||
                    lead.current_process ||
                    lead.notes;

                  return (
                    <tr key={lead.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-subtle)] align-top">
                      <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                        {fmtDate(lead.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TIER_BADGE_CLS}`}>
                          {lead.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {lead.lead_type === "quote_email" ? (
                          <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--surface-subtle)] text-[var(--text-secondary)] border border-[var(--border)]">
                            Quote Copy
                          </span>
                        ) : (
                          <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--surface-subtle)] text-[var(--text-secondary)] border border-[var(--border)]">
                            {lead.lead_type ?? "tier_interest"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{lead.name}</td>
                      <td className="px-4 py-3">
                        <a
                          href={`mailto:${lead.email}`}
                          className="font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          {lead.email}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{lead.company ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{lead.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--text-faint)]">{lead.quote_no ?? "—"}</td>
                      <td className="px-4 py-3">
                        {lead.annual_mode ? (
                          <span className="text-[var(--status-success-text)]">Annual</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">Monthly</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {hasDetails ? (
                          <details className="group">
                            <summary className="cursor-pointer select-none list-none text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition whitespace-nowrap">
                              Details ▾
                            </summary>
                            <div className="mt-2 space-y-1.5 min-w-[200px]">
                              {lead.user_count && (
                                <div>
                                  <span className="text-[var(--text-faint)] uppercase tracking-wider text-[10px]">Seats — </span>
                                  <span className="text-[var(--text-secondary)]">{lead.user_count}</span>
                                </div>
                              )}
                              {lead.product_description && (
                                <div>
                                  <span className="text-[var(--text-faint)] uppercase tracking-wider text-[10px]">Packaging — </span>
                                  <span className="text-[var(--text-secondary)]">{lead.product_description}</span>
                                </div>
                              )}
                              {lead.current_process && (
                                <div>
                                  <span className="text-[var(--text-faint)] uppercase tracking-wider text-[10px]">Quotes today — </span>
                                  <span className="text-[var(--text-secondary)]">{lead.current_process}</span>
                                </div>
                              )}
                              {lead.notes && (
                                <div>
                                  <span className="text-[var(--text-faint)] uppercase tracking-wider text-[10px]">Notes — </span>
                                  <span className="text-[var(--text-secondary)]">{lead.notes}</span>
                                </div>
                              )}
                            </div>
                          </details>
                        ) : (
                          <span className="text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
