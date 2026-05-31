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

const TIER_BADGE: Record<string, string> = {
  Starter: "bg-neutral-700 text-neutral-300 border border-neutral-600",
  Pro:     "bg-sky-900/40 text-sky-300 border border-sky-800",
  Shop:    "bg-violet-900/40 text-violet-300 border border-violet-800",
};

export default async function LeadsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user || user.role !== "admin") redirect("/login");

  const leads = await q<LeadRow>(
    `SELECT id, tier, name, email, company, phone, quote_no,
            annual_mode, created_at
     FROM demo_leads
     ORDER BY created_at DESC
     LIMIT 500`,
  );

  const total   = leads.length;
  const starter = leads.filter((l) => l.tier === "Starter").length;
  const pro     = leads.filter((l) => l.tier === "Pro").length;
  const shop    = leads.filter((l) => l.tier === "Shop").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Demo Leads</h1>
          <p className="mt-0.5 text-xs text-neutral-500">
            Contacts who requested access after viewing the live demo
          </p>
        </div>
        <span className="rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300">
          {fmt(total)} total
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Total Leads</div>
          <div className="text-2xl font-bold text-white">{fmt(total)}</div>
        </div>
        <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Starter Interest</div>
          <div className="text-2xl font-bold text-white">{fmt(starter)}</div>
        </div>
        <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Pro Interest</div>
          <div className="text-2xl font-bold text-sky-300">{fmt(pro)}</div>
        </div>
        <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Shop Interest</div>
          <div className="text-2xl font-bold text-violet-300">{fmt(shop)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800">
                <th className="px-4 py-3 text-left font-medium text-neutral-500 whitespace-nowrap">Date</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Tier</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Company</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Quote</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500">Billing</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-neutral-600">
                    No leads yet — they&apos;ll appear here after someone completes a demo and requests access
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-800/40">
                    <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">
                      {fmtDate(lead.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TIER_BADGE[lead.tier] ?? "bg-neutral-700 text-neutral-300 border border-neutral-600"}`}>
                        {lead.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-200 font-medium">{lead.name}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`mailto:${lead.email}`}
                        className="font-mono text-neutral-400 hover:text-sky-400"
                      >
                        {lead.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-neutral-300">{lead.company ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-400">{lead.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-500">{lead.quote_no ?? "—"}</td>
                    <td className="px-4 py-3">
                      {lead.annual_mode ? (
                        <span className="text-green-400">Annual</span>
                      ) : (
                        <span className="text-neutral-500">Monthly</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
