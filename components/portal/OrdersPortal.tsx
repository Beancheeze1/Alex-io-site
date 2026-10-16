// components/portal/OrdersPortal.tsx
//
// Step 34A: the buyer portal on /t/[slug]/orders.
//   Signed out: "Email me a sign-in link" (POST /api/portal/request).
//   Signed in:  every quote / order for the buyer's email at this shop
//               (GET /api/portal/orders): stage, total, PO, what's left to do,
//               the timeline, documents and tracking. "Open" goes through
//               /api/portal/open, which lets this browser accept / answer
//               proofs / add a ship-to on the quote page.
//               Step 34B: "Reorder" on orders that went into production.
"use client";

import * as React from "react";
import type { PortalOrder } from "@/app/lib/portal";
import ReorderButton from "@/components/quote/ReorderButton";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "error"; message: string }
  | { kind: "orders"; email: string; orders: PortalOrder[] };

export default function OrdersPortal({
  tenantSlug,
  brandName,
  primaryColor,
  onPrimary,
}: {
  tenantSlug: string;
  brandName: string;
  primaryColor: string;
  onPrimary: string;
}) {
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/portal/orders?tenant=${encodeURIComponent(tenantSlug)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.status === 401) setState({ kind: "signed_out" });
      else if (!r.ok || !j?.ok) setState({ kind: "error", message: j?.message || `Couldn't load your orders (HTTP ${r.status}).` });
      else setState({ kind: "orders", email: String(j.email || ""), orders: (j.orders || []) as PortalOrder[] });
    } catch {
      setState({ kind: "error", message: "Network error. Please check your connection and try again." });
    }
  }, [tenantSlug]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/portal/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: tenantSlug, email }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) setNote({ ok: true, text: String(j.message || "Check your email for a sign-in link.") });
      else
        setNote({
          ok: false,
          text: r.status === 429 ? "Too many attempts. Please wait a minute and try again." : j?.message || "Something went wrong. Please try again.",
        });
    } catch {
      setNote({ ok: false, text: "Network error. Please check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/portal/signout", { method: "POST" }).catch(() => null);
    setState({ kind: "signed_out" });
  }

  const card: React.CSSProperties = { background: "var(--surface-card)", border: "1px solid var(--border)" };
  const primaryBtn: React.CSSProperties = { background: primaryColor, color: onPrimary };

  if (state.kind === "loading") return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  if (state.kind === "error") {
    return (
      <p role="alert" style={{ color: "var(--attention)" }} data-portal-error>
        {state.message}
      </p>
    );
  }

  if (state.kind === "signed_out") {
    return (
      <div className="max-w-[520px] rounded-xl p-7 shadow-[0_16px_40px_rgba(0,0,0,0.12)]" style={card} data-portal-signed-out>
        <p className="mb-4" style={{ color: "var(--text-secondary)" }}>
          Enter the email your quotes from {brandName} were sent to. We&apos;ll email you a link to sign in, with no password needed.
        </p>
        <form onSubmit={requestLink} className="flex flex-col gap-2.5" noValidate>
          <label className="text-sm" style={{ color: "var(--text-muted)" }}>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md px-3 py-2.5 text-[15px]"
              style={{ border: "1px solid var(--border-strong)", background: "var(--surface-page)", color: "var(--text-primary)" }}
              data-portal-email
            />
          </label>
          {note ? (
            <p role={note.ok ? "status" : "alert"} className="text-sm" style={{ color: note.ok ? "var(--text-primary)" : "var(--attention)" }} data-portal-note>
              {note.text}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="mt-1 inline-flex min-h-[48px] items-center justify-center self-start rounded-md px-5 text-[15px] font-medium disabled:opacity-50"
            style={primaryBtn}
            data-portal-request
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      </div>
    );
  }

  const orders = state.orders;
  const needsYou = orders.filter((o) => o.actions.length > 0);
  const shown = showAll ? orders : orders.filter((o) => o.stage !== "expired");

  return (
    <div data-portal-orders>
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        <span>
          Signed in as <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{state.email}</span>
        </span>
        <button type="button" onClick={() => void signOut()} className="underline" data-portal-signout>
          Sign out
        </button>
      </div>

      {orders.length === 0 ? (
        <p style={{ color: "var(--text-secondary)" }}>No quotes or orders yet.</p>
      ) : (
        <>
          {needsYou.length ? (
            <div className="mb-6 rounded-xl p-4" style={{ ...card, borderLeft: `4px solid ${primaryColor}` }} data-portal-needs-you>
              <div className="mb-1 font-medium">Waiting for you</div>
              <ul className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {needsYou.map((o) => (
                  <li key={o.quote_no}>
                    <a href={o.open_url} className="underline" style={{ color: "var(--text-primary)" }}>
                      {o.quote_no}
                    </a>
                    : {o.actions.map((a) => a.label).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            {shown.map((o) => (
              <div key={o.quote_no} className="rounded-xl p-5" style={card} data-portal-order={o.quote_no} data-stage={o.stage}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <a href={o.open_url} className="text-lg font-medium hover:underline">
                    {o.quote_no}
                  </a>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      background: o.stage === "shipped" || o.stage === "in_production" ? primaryColor : "var(--surface-page)",
                      color: o.stage === "shipped" || o.stage === "in_production" ? onPrimary : "var(--text-secondary)",
                      border: "1px solid var(--border)",
                    }}
                    data-portal-stage
                  >
                    {o.stage_label}
                  </span>
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {day(o.created_at)}
                    {o.po ? ` · PO ${o.po}` : ""}
                    {o.total != null ? ` · ${usd(o.total)}` : ""}
                  </span>
                </div>

                {o.actions.length || o.stage === "in_production" || o.stage === "shipped" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {o.stage === "in_production" || o.stage === "shipped" ? (
                      <ReorderButton
                        quoteNo={o.quote_no}
                        endpoint="/api/portal/reorder"
                        buttonClassName="inline-flex min-h-[40px] items-center rounded-md px-4 text-sm font-medium"
                        buttonStyle={{ border: "1px solid var(--border-strong)" }}
                      />
                    ) : null}
                    {o.actions.map((a) => (
                      <a
                        key={a.key}
                        href={o.open_url}
                        className="inline-flex min-h-[40px] items-center rounded-md px-4 text-sm font-medium"
                        style={primaryBtn}
                        data-portal-action={a.key}
                      >
                        {a.label}
                      </a>
                    ))}
                  </div>
                ) : null}

                <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm" data-portal-timeline>
                  {o.timeline.map((s) => (
                    <li key={s.key} className="flex items-center gap-1.5" data-step={s.key} data-done={s.done ? "1" : "0"}>
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: s.done ? primaryColor : "transparent", border: `2px solid ${s.done ? primaryColor : "var(--border-strong)"}` }}
                      />
                      <span style={{ color: s.done ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {s.label}
                        {s.at && s.done ? ` ${day(s.at)}` : ""}
                        {s.detail ? ` (${s.detail})` : ""}
                      </span>
                    </li>
                  ))}
                </ol>

                {o.shipped ? (
                  <div className="mt-3 text-sm" data-portal-shipped>
                    Shipped {day(o.shipped.at)}
                    {o.shipped.carrier ? ` by ${o.shipped.carrier}` : ""}
                    {o.shipped.tracking ? (
                      <>
                        {": "}
                        {o.shipped.tracking_url ? (
                          <a href={o.shipped.tracking_url} target="_blank" rel="noreferrer" className="font-medium underline">
                            {o.shipped.tracking}
                          </a>
                        ) : (
                          <span className="font-medium">{o.shipped.tracking}</span>
                        )}
                      </>
                    ) : null}
                    {o.shipped.note ? <div style={{ color: "var(--text-secondary)" }}>{o.shipped.note}</div> : null}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-4 text-sm" data-portal-docs>
                  {o.docs.map((d) => (
                    <a key={d.url} href={d.url} className="underline" target={d.url.startsWith("/api/quote-attachments/") ? "_blank" : undefined} rel="noreferrer">
                      {d.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {orders.some((o) => o.stage === "expired") ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-4 text-sm underline" data-portal-show-expired>
              {showAll ? "Hide expired estimates" : `Show expired estimates (${orders.filter((o) => o.stage === "expired").length})`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
