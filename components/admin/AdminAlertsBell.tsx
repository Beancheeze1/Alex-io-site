// components/admin/AdminAlertsBell.tsx
//
// Bell + unread badge in the admin header (Step 7). Polls the unread count
// every 60 s; clicking opens the latest 50 alerts. Clicking an alert marks it
// read and opens its link.

"use client";

import * as React from "react";

type Alert = {
  id: number;
  kind: string;
  quote_no: string | null;
  title: string;
  detail: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

const KIND_LABEL: Record<string, string> = {
  new_quote: "New quote",
  artwork: "Artwork",
  buyer_change: "Buyer change",
  spec_request: "Spec request",
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export default function AdminAlertsBell() {
  const [unread, setUnread] = React.useState<number>(0);
  const [open, setOpen] = React.useState<boolean>(false);
  const [alerts, setAlerts] = React.useState<Alert[] | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  const loadCount = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/alerts?count=1", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (j?.ok) setUnread(Number(j.unread) || 0);
    } catch {
      // ignore
    }
  }, []);

  const loadList = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/alerts", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (j?.ok) {
        setAlerts(Array.isArray(j.alerts) ? j.alerts : []);
        setUnread(Number(j.unread) || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 60_000);
    return () => clearInterval(t);
  }, [loadCount]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const markRead = async (body: { all?: boolean; ids?: number[] }) => {
    try {
      await fetch("/api/admin/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // ignore
    }
  };

  const onToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const onAlertClick = async (a: Alert) => {
    if (!a.read_at) await markRead({ ids: [a.id] });
    if (a.link) {
      window.location.href = a.link;
    } else {
      loadList();
    }
  };

  const onMarkAll = async () => {
    await markRead({ all: true });
    loadList();
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
        title="Alerts"
        className="relative rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 999,
              background: "#dc2626",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: "16px",
              textAlign: "center",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Alerts"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: 440,
            overflowY: "auto",
            zIndex: 50,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--surface-card)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Alerts</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={onMarkAll}
                style={{ fontSize: 12, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {loading && !alerts ? (
            <p style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>Loading…</p>
          ) : !alerts || alerts.length === 0 ? (
            <p style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>No alerts yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {alerts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onAlertClick(a)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      borderBottom: "1px solid var(--surface-subtle)",
                      background: a.read_at ? "transparent" : "var(--surface-subtle)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                        {KIND_LABEL[a.kind] || a.kind}
                        {a.quote_no ? ` · ${a.quote_no}` : ""}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{timeAgo(a.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: a.read_at ? 400 : 600, color: "var(--text-primary)", marginTop: 2 }}>
                      {a.title}
                    </div>
                    {a.detail ? (
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, overflowWrap: "anywhere" }}>{a.detail}</div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
