// app/quote/page.tsx
//
// Print-friendly view of a quote by quote_no.
// URL pattern: /quote?quote_no=Q-AI-20251116-115613
//
// Now implemented as a client page that:
//  - Reads quote_no from the URL on the client
//  - Calls /api/quote/print to fetch data
//  - Always renders a shell (no early returns that blank the page)

"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

type ItemRow = {
  id: number;
  quote_id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  material_name: string | null;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

type ApiResponse =
  | {
      ok: true;
      quote: QuoteRow;
      items: ItemRow[];
      layoutPkg: LayoutPkgRow | null;
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

function usd(value: number | null | undefined): string {
  if (value == null || !isFinite(Number(value))) return "$0.00";
  const n = Number(value);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default function QuotePage() {
  const searchParams = useSearchParams();

  // Initial quote_no from router
  const initialQuoteNo = searchParams?.get("quote_no") || "";
  const [quoteNo, setQuoteNo] = React.useState<string>(initialQuoteNo);

  const [loading, setLoading] = React.useState<boolean>(
    !!(initialQuoteNo || quoteNo),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState<string | null>(null);
  const [quote, setQuote] = React.useState<QuoteRow | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(
    null,
  );

  // Client-side rescue: if we still don't have quoteNo, try window.location
  React.useEffect(() => {
    if (quoteNo) return;
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    const fromWindow = urlParams.get("quote_no") || "";
    if (fromWindow) {
      setQuoteNo(fromWindow);
    } else {
      setLoading(false);
    }
  }, [quoteNo]);

  // When quoteNo becomes available, fetch quote data from API
  React.useEffect(() => {
    if (!quoteNo) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(null);
      setQuote(null);
      setItems([]);
      setLayoutPkg(null);

      try {
        const res = await fetch(
          `/api/quote/print?quote_no=${encodeURIComponent(quoteNo)}`,
          { cache: "no-store" },
        );

        const json = (await res.json()) as ApiResponse;

        if (!res.ok) {
          // 404 or other error
          if ("ok" in json && json.ok === false) {
            if (json.error === "NOT_FOUND") {
              if (!cancelled) {
                setNotFound(json.message || "Quote not found.");
              }
            } else {
              if (!cancelled) {
                setError(
                  json.message ||
                    "There was a problem loading this quote.",
                );
              }
            }
          } else if (!cancelled) {
            setError("There was a problem loading this quote.");
          }
          return;
        }

        if ("ok" in json && json.ok === true) {
          if (!cancelled) {
            setQuote(json.quote);
            setItems(json.items || []);
            setLayoutPkg(json.layoutPkg || null);
          }
        } else if (!cancelled) {
          setError("Unexpected response from quote API.");
        }
      } catch (err) {
        console.error("Error fetching /api/quote/print:", err);
        if (!cancelled) {
          setError(
            "There was an unexpected problem loading this quote. Please try again.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [quoteNo]);

  const overallQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  const notesPreview =
    layoutPkg?.notes && layoutPkg.notes.trim().length
      ? layoutPkg.notes.trim().length > 140
        ? layoutPkg.notes.trim().slice(0, 140) + "…"
        : layoutPkg.notes.trim()
      : null;

  const svgDownloadHref =
    layoutPkg?.svg_text && layoutPkg.svg_text.trim().length
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          layoutPkg.svg_text,
        )}`
      : null;

  const dxfDownloadHref =
    layoutPkg?.dxf_text && layoutPkg.dxf_text.trim().length
      ? `data:application/dxf;charset=utf-8,${encodeURIComponent(
          layoutPkg.dxf_text,
        )}`
      : null;

  const stepDownloadHref =
    layoutPkg?.step_text && layoutPkg.step_text.trim().length
      ? `data:application/step;charset=utf-8,${encodeURIComponent(
          layoutPkg.step_text,
        )}`
      : null;

  // ===================== RENDER =====================
  return (
    <div
      style={{
        fontFamily:
          "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
        background: "#f3f4f6",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "16px",
          padding: "24px 24px 32px 24px",
          boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        }}
      >
        {/* Case A: No quote number at all */}
        {!quoteNo && !loading && (
          <>
            <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>
              Quote not found
            </h1>
            <p style={{ color: "#555" }}>
              We couldn&apos;t find a quote number in this link. Please
              double-check the URL or open the quote directly from your
              inbox.
            </p>
          </>
        )}

        {/* Case B: Loading */}
        {loading && (
          <>
            <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>
              Loading quote…
            </h1>
            <p style={{ color: "#6b7280", fontSize: "13px" }}>
              Please wait while we load the latest version of this quote.
            </p>
          </>
        )}

        {/* Case C: Not found from API */}
        {!loading && notFound && (
          <>
            <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>
              Quote not found
            </h1>
            <p style={{ color: "#555" }}>
              {notFound}{" "}
              {quoteNo ? (
                <>
                  (quote number: <code>{quoteNo}</code>)
                </>
              ) : null}
            </p>
          </>
        )}

        {/* Case D: Hard error */}
        {!loading && error && !quote && (
          <>
            <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>
              Problem loading quote
            </h1>
            {quoteNo && (
              <p style={{ color: "#555", marginBottom: "6px" }}>
                Quote number: <code>{quoteNo}</code>
              </p>
            )}
            <p style={{ color: "#6b7280", fontSize: "13px" }}>
              {error}
            </p>
          </>
        )}

        {/* Case E: Happy path — quote loaded */}
        {!loading && quote && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "16px",
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontSize: "22px" }}>
                  Quote #{quote.quote_no}
                </h1>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    color: "#4b5563",
                  }}
                >
                  {quote.customer_name}
                  {quote.email ? <> &middot; {quote.email}</> : null}
                  {quote.phone ? <> &middot; {quote.phone}</> : null}
                </p>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    color: "#6b7280",
                    fontSize: "12px",
                  }}
                >
                  Created:{" "}
                  {new Date(quote.created_at).toLocaleString()}
                </p>
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontSize: "12px",
                  color: "#6b7280",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background:
                      quote.status === "sent"
                        ? "#d1fae5"
                        : quote.status === "accepted"
                        ? "#bfdbfe"
                        : "#e5e7eb",
                    color:
                      quote.status === "sent"
                        ? "#065f46"
                        : quote.status === "accepted"
                        ? "#1d4ed8"
                        : "#374151",
                  }}
                >
                  {quote.status.toUpperCase()}
                </div>
                <div style={{ marginTop: "8px" }}>
                  <span style={{ color: "#9ca3af" }}>
                    Use your browser&apos;s <strong>Print</strong>{" "}
                    command to print this page.
                  </span>
                </div>
              </div>
            </div>

            <hr
              style={{
                border: "none",
                borderTop: "1px solid #e5e7eb",
                margin: "16px 0",
              }}
            />

            <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>
              Line items
            </h2>

            {items.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No line items stored for this quote yet. Once the material
                and details are finalized, the primary line will appear
                here.
              </p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "13px",
                  marginBottom: "16px",
                }}
              >
                <thead>
                  <tr style={{ background: "#eff6ff" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "8px",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Item
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "8px",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Dimensions (L × W × H)
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "8px",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Qty
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const dims = `${item.length_in} × ${item.width_in} × ${item.height_in}`;
                    const label =
                      item.material_name ||
                      `Material #${item.material_id}`;
                    return (
                      <tr key={item.id}>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          <div style={{ fontWeight: 500 }}>
                            Line {idx + 1}
                          </div>
                          <div style={{ color: "#6b7280" }}>
                            {label}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          {dims}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom: "1px solid #f3f4f6",
                            textAlign: "right",
                          }}
                        >
                          {item.qty}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "8px",
              }}
            >
              <div style={{ textAlign: "right" }}>
                <div
                  style={{ fontSize: "12px", color: "#6b7280" }}
                >
                  Total quantity
                </div>
                <div
                  style={{ fontSize: "18px", fontWeight: 600 }}
                >
                  {overallQty}
                </div>
              </div>
            </div>

            {/* Foam layout package summary + preview + downloads */}
            <hr
              style={{
                border: "none",
                borderTop: "1px solid #e5e7eb",
                margin: "24px 0 16px 0",
              }}
            />
            <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>
              Foam layout package
            </h2>
            {!layoutPkg ? (
              <p style={{ color: "#6b7280", fontSize: "13px" }}>
                No foam layout has been saved for this quote yet. Use the{" "}
                <strong>Open layout preview</strong> button in the
                emailed quote to arrange cavities, then click{" "}
                <strong>Apply to quote</strong> to store the layout
                here.
              </p>
            ) : (
              <div
                style={{
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: "12px 14px",
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "#111827",
                        marginBottom: "2px",
                      }}
                    >
                      Layout package #{layoutPkg.id}
                    </div>
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: "12px",
                      }}
                    >
                      Saved:{" "}
                      {new Date(
                        layoutPkg.created_at,
                      ).toLocaleString()}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: "12px",
                    }}
                  >
                    <a
                      href={`/quote/layout?quote_no=${encodeURIComponent(
                        quote.quote_no,
                      )}`}
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        border: "1px solid #c7d2fe",
                        background: "#eef2ff",
                        color: "#1d4ed8",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      Open layout editor
                    </a>
                  </div>
                </div>

                {notesPreview && (
                  <div
                    style={{
                      marginTop: "6px",
                      color: "#4b5563",
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>
                      Notes:{" "}
                    </span>
                    {notesPreview}
                  </div>
                )}

                {/* Inline SVG preview, if we have one */}
                {layoutPkg.svg_text &&
                  layoutPkg.svg_text.trim().length > 0 && (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "8px",
                        borderRadius: "10px",
                        border: "1px solid #e5e7eb",
                        background: "#ffffff",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          color: "#374151",
                          marginBottom: "6px",
                        }}
                      >
                        Layout preview
                      </div>
                      <div
                        style={{
                          width: "100%",
                          maxHeight: "260px",
                          overflow: "hidden",
                          borderRadius: "8px",
                          border: "1px solid #e5e7eb",
                          background: "#f3f4f6",
                        }}
                        // The SVG comes from your own generator (/quote/layout),
                        // so we can safely render it inline for print preview.
                        dangerouslySetInnerHTML={{
                          __html: layoutPkg.svg_text,
                        }}
                      />
                    </div>
                  )}

                {/* Download buttons for layout assets */}
                <div
                  style={{
                    marginTop: "10px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    fontSize: "12px",
                  }}
                >
                  {svgDownloadHref && (
                    <a
                      href={svgDownloadHref}
                      download={`quote-${quote.quote_no}-layout.svg`}
                      style={{
                        display: "inline-block",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid #c7d2fe",
                        background: "#eef2ff",
                        color: "#1d4ed8",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      Download SVG
                    </a>
                  )}
                  {dxfDownloadHref && (
                    <a
                      href={dxfDownloadHref}
                      download={`quote-${quote.quote_no}-layout.dxf`}
                      style={{
                        display: "inline-block",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: "#f9fafb",
                        color: "#374151",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      Download DXF
                    </a>
                  )}
                  {stepDownloadHref && (
                    <a
                      href={stepDownloadHref}
                      download={`quote-${quote.quote_no}-layout.step`}
                      style={{
                        display: "inline-block",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: "#f9fafb",
                        color: "#374151",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      Download STEP
                    </a>
                  )}
                </div>

                <div
                  style={{
                    marginTop: "6px",
                    color: "#6b7280",
                    fontSize: "12px",
                  }}
                >
                  DXF export:{" "}
                  {layoutPkg.dxf_text
                    ? "stored"
                    : "not generated yet"}{" "}
                  · STEP export:{" "}
                  {layoutPkg.step_text
                    ? "stored"
                    : "not generated yet"}
                </div>
              </div>
            )}

            <p
              style={{
                marginTop: "24px",
                fontSize: "12px",
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              This print view mirrors the core specs of your emailed
              quote. Actual charges may differ if specs or quantities
              change or if additional services are requested.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
