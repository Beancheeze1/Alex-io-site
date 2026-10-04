// app/admin/spec-requests/page.tsx
//
// Spec request inbox for the logged-in user's tenant (admin, cs, sales).
// Shows every request with its files and both email outcomes, so a failed
// or missing notification is visible instead of silent.

import { redirect } from "next/navigation";
import { getCurrentUserFromCookies, isRoleAllowed } from "@/lib/auth";
import { q } from "@/lib/db";
import SpecRequestStatus from "@/components/admin/SpecRequestStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
  notify_status: string;
  notify_error: string | null;
  confirm_status: string;
  created_at: string;
  sales_rep_slug: string | null;
  rep_name: string | null;
  files: { id: number; filename: string; size_bytes: number }[];
};

function badge(kind: "ok" | "warn" | "bad" | "neutral", text: string) {
  const styles = {
    ok: "bg-[var(--status-success-bg)] text-[var(--status-success-text)]",
    warn: "bg-[var(--status-pending-bg)] text-[var(--status-pending-text)]",
    bad: "bg-[var(--attention-bg)] text-[var(--attention)]",
    neutral: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]",
  }[kind];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${styles}`}>{text}</span>;
}

function notifyBadge(s: string) {
  if (s === "sent") return badge("ok", "Shop notified");
  if (s === "failed") return badge("bad", "Notification failed");
  if (s === "no_recipient") return badge("bad", "No notification address");
  return badge("warn", "Notification pending");
}

function confirmBadge(s: string) {
  if (s === "sent") return badge("ok", "Buyer confirmed");
  if (s === "failed") return badge("bad", "Buyer confirmation failed");
  return badge("warn", "Confirmation pending");
}

export default async function SpecRequestsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?next=/admin/spec-requests");
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) redirect("/admin");

  const rows = await q<Row>(
    `
    SELECT r.id, r.name, r.email, r.company, r.phone, r.notes, r.status,
           r.notify_status, r.notify_error, r.confirm_status, r.created_at::text AS created_at,
           r.sales_rep_slug, u.name AS rep_name,
           COALESCE(
             json_agg(json_build_object('id', f.id, 'filename', f.filename, 'size_bytes', f.size_bytes) ORDER BY f.id)
               FILTER (WHERE f.id IS NOT NULL),
             '[]'
           ) AS files
    FROM public.spec_requests r
    LEFT JOIN public.spec_request_files f ON f.spec_request_id = r.id
    LEFT JOIN public."users" u ON u.id = r.sales_rep_id
    WHERE r.tenant_id = $1
    GROUP BY r.id, u.name
    ORDER BY r.created_at DESC
    LIMIT 200
    `,
    [user.tenant_id],
  );

  return (
    <div className="space-y-4 p-2">
      <div>
        <div className="text-xl font-medium">Spec requests</div>
        <div className="text-xs text-[var(--text-muted)]">
          Sent from your Quotes &amp; ordering page. Newest first.
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-[var(--border)] bg-[var(--surface-card)] p-6 text-sm text-[var(--text-muted)]">
          No spec requests yet.
        </div>
      ) : null}

      {rows.map((r) => (
        <div key={r.id} className="space-y-2 rounded border border-[var(--border)] bg-[var(--surface-card)] p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-medium">{r.name}</span>
            {r.company ? <span className="text-sm text-[var(--text-secondary)]">{r.company}</span> : null}
            <span className="text-xs text-[var(--text-muted)]">
              {new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {notifyBadge(r.notify_status)}
              {confirmBadge(r.confirm_status)}
              <SpecRequestStatus id={Number(r.id)} initial={r.status} />
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-sm">
            <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a>
            {r.phone ? <span>{r.phone}</span> : null}
          </div>
          {r.sales_rep_slug ? (
            <div className="text-xs text-[var(--text-secondary)]">
              Referred by{" "}
              {r.rep_name ? (
                <span className="font-medium text-[var(--text-primary)]">{r.rep_name}</span>
              ) : (
                <>rep link “{r.sales_rep_slug}” (no matching rep)</>
              )}{" "}
              — credit them when you build the quote.
            </div>
          ) : null}
          {r.notes ? <p className="whitespace-pre-line text-sm text-[var(--text-secondary)]">{r.notes}</p> : null}
          {r.files.length ? (
            <div className="flex flex-wrap gap-2">
              {r.files.map((f) => (
                <a
                  key={f.id}
                  href={`/api/admin/spec-requests/files/${f.id}`}
                  className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs hover:bg-[var(--surface-subtle)]"
                >
                  ⬇ {f.filename} ({Math.max(1, Math.round(f.size_bytes / 1024))} KB)
                </a>
              ))}
            </div>
          ) : null}
          {r.notify_status === "failed" && r.notify_error ? (
            <div className="text-[11px] text-[var(--attention)]">Notification error: {r.notify_error}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
