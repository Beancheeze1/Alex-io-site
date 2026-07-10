// components/admin/QuoteAttachmentsPanel.tsx
//
// Read-only list of files uploaded/stored against a quote (sketches, PDFs,
// normalized CAD, etc.), fetched from GET /api/quote-attachments?quote_no=...
//
// Internal engine artifacts (forge_faces.json / forge_manifest.json) are
// filtered out — they're not useful for a rep to open.

"use client";

import * as React from "react";

type Attachment = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

const HIDDEN_FILENAMES = new Set(["forge_faces.json", "forge_manifest.json"]);

function formatSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const cardBase: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  padding: "12px 14px",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
  marginBottom: 6,
};

export default function QuoteAttachmentsPanel({ quoteNo }: { quoteNo: string }) {
  const [attachments, setAttachments] = React.useState<Attachment[] | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!quoteNo) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/quote-attachments?quote_no=${encodeURIComponent(quoteNo)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => null);

        if (!res.ok || !json || !json.ok) {
          throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
        }

        if (!cancelled) {
          setAttachments(Array.isArray(json.attachments) ? json.attachments : []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(String(err?.message || err) || "Couldn't load attachments.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [quoteNo]);

  const visible = (attachments || []).filter((a) => !HIDDEN_FILENAMES.has(a.filename));

  return (
    <div style={{ ...cardBase, background: "#ffffff", marginBottom: 20 }}>
      <div style={cardTitleStyle}>Attachments</div>

      {loading && (
        <p style={{ fontSize: 12, color: "#6b7280" }}>Loading attachments…</p>
      )}

      {!loading && error && (
        <p style={{ fontSize: 12, color: "#b91c1c" }}>{error}</p>
      )}

      {!loading && !error && visible.length === 0 && (
        <p style={{ fontSize: 12, color: "#6b7280" }}>No attachments on this quote yet.</p>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {visible.map((a) => (
            <li
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "6px 0",
                borderBottom: "1px solid #f0f1f3",
                fontSize: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: "#111827", overflowWrap: "anywhere" }}>
                  {a.filename}
                </div>
                <div style={{ color: "#6b7280", fontSize: 11 }}>
                  {[a.content_type, formatSize(a.size_bytes)].filter(Boolean).join(" • ")}
                </div>
              </div>
              <a
                href={`/api/quote-attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid #7c3aed",
                  background: "#ede9fe",
                  color: "#5b21b6",
                  fontSize: 11,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                View / Download <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
