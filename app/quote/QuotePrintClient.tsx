// TEST BUMP 1
// app/quote/QuotePrintClient.tsx
//
// Client component that:
//  - Reads quote_no from the URL
//  - Calls /api/quote/print to fetch data
//  - Renders the full print view for the client:
//
// Header:
//   - Quote number, customer info, status
//   - Print, Forward to sales, Schedule a call buttons
//
// Body:
//   - Quote overview (specs from primary line item) in a "Specs" card
//   - Pricing summary in a "Pricing" card
//   - Layout status in a "Layout & next steps" card
//   - Line items table (with pricing columns if present) in a card
//   - Foam layout package summary + inline SVG preview
//
// Important:
//   - No SVG/DXF/STEP download links here (client shouldn’t be able to download CAD files).
//   - Layout file downloads can be added later on an internal/admin-only page.

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
  price_unit_usd?: string | null;
  price_total_usd?: string | null;
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

type ApiOk = {
  ok: true;
  quote: QuoteRow;
  items: ItemRow[];
  layoutPkg: LayoutPkgRow | null;
};

type ApiErr = {
  ok: false;
  error: string;
  message: string;
};

type ApiResponse = ApiOk | ApiErr;

function parsePriceField(
  raw: string | number | null | undefined,
): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export default function QuotePrintClient() {
  const searchParams = useSearchParams();

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

  // Ref to the SVG preview container so we can scale/center the inner <svg>
  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Print handler
  const handlePrint = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.print();
    }
  }, []);

  // Forward-to-sales handler (mailto with quote number + link)
  const handleForwardToSales = React.useCallback(() => {
    if (typeof window === "undefined" || !quoteNo) return;

    const salesEmail =
      (process.env.NEXT_PUBLIC_SALES_FORWARD_TO as string | undefined) ||
      "sales@example.com";

    const subject = "Quote " + quoteNo;
    const bodyLines = [
      "Quote number: " + quoteNo,
      "",
      "View this quote:",
      window.location.href,
      "",
    ];
    const body = encodeURIComponent(bodyLines.join("\n"));

    const mailto =
      "mailto:" +
      encodeURIComponent(salesEmail) +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      body;

    window.location.href = mailto;
  }, [quoteNo]);

  // Schedule call handler (Calendly or Google Calendar URL)
  const handleScheduleCall = React.useCallback(() => {
    if (typeof window === "undefined") return;

    const url =
      (process.env.NEXT_PUBLIC_SCHEDULE_CALL_URL as string | undefined) ||
      "https://calendly.com/your-company/30min";

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // Rescue: if router searchParams didn’t have quote_no, fall back to window.location
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

  // Fetch quote data
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
          "/api/quote/print?quote_no=" + encodeURIComponent(quoteNo),
          { cache: "no-store" },
        );

        const json = (await res.json()) as ApiResponse;

        if (!res.ok) {
          if (!cancelled) {
            if (!json.ok && json.error === "NOT_FOUND") {
              setNotFound(json.message || "Quote not found.");
            } else if (!json.ok) {
              setError(json.message || "There was a problem loading this quote.");
            } else {
              setError("There was a problem loading this quote.");
            }
          }
          return;
        }

        if (!cancelled) {
          if (json.ok) {
            setQuote(json.quote);
            setItems(json.items || []);
            setLayoutPkg(json.layoutPkg || null);
          } else {
            setError("Unexpected response from quote API.");
          }
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

  const subtotal = items.reduce((sum, i) => {
    const lineTotal = parsePriceField(i.price_total_usd) ?? 0;
    return sum + lineTotal;
  }, 0);

  const anyPricing = subtotal > 0;

  const notesPreview =
    layoutPkg && layoutPkg.notes && layoutPkg.notes.trim().length > 0
      ? layoutPkg.notes.trim().length > 140
        ? layoutPkg.notes.trim().slice(0, 140) + "..."
        : layoutPkg.notes.trim()
      : null;

  // Normalize SVG preview
  React.useEffect(() => {
    if (!layoutPkg) return;
    if (!svgContainerRef.current) return;

    const svgEl = svgContainerRef.current.querySelector("svg") as
      | SVGSVGElement
      | null;

    if (!svgEl) return;

    try {
      svgEl.removeAttribute("width");
      svgEl.removeAttribute("height");
      svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

      svgEl.style.width = "100%";
      svgEl.style.height = "100%";
      svgEl.style.display = "block";
      svgEl.style.margin = "0 auto";
    } catch (e) {
      console.warn("Could not normalize SVG preview:", e);
    }
  }, [layoutPkg]);

  const primaryItem = items[0] || null;

  // Shared card styles to feel like the email blocks
  const cardBase = {
    borderRadius: 16,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    padding: "12px 14px",
  };

  const cardTitleStyle = {
    fontSize: 13,
    fontWeight: 600,
    color: "#0f172a",
    marginBottom: 6,
  };

  const labelStyle = {
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#6b7280",
    marginBottom: 2,
  };

  // ===================== RENDER =====================
  return (
    <div
      style={{
        fontFamily:
          "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
        background: "#020617", // outer background
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "24px",
          padding: "24px 24px 32px 24px",
          boxShadow: "0 18px 45px rgba(15,23,42,0.55)",
        }}
      >
        {/* No quote number at all */}
        {!quoteNo && !loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#6b7280" }}>
              We could not find a quote number in this link. Please double-check
              the URL or open the quote directly from your inbox.
            </p>
          </>
        )}

        {/* Loading */}
        {loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Loading quote...</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              Please wait while we load the latest version of this quote.
            </p>
          </>
        )}

        {/* Not found from API */}
        {!loading && notFound && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#6b7280" }}>
              {notFound}{" "}
              {quoteNo ? (
                <>
                  (quote number: <code>{quoteNo}</code>)
                </>
              ) : null}
            </p>
          </>
        )}

        {/* Hard error */}
        {!loading && error && !quote && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>
              Problem loading quote
            </h1>
            {quoteNo && (
              <p style={{ color: "#6b7280", marginBottom: 6 }}>
                Quote number: <code>{quoteNo}</code>
              </p>
            )}
            <p style={{ color: "#6b7280", fontSize: 13 }}>{error}</p>
          </>
        )}

        {/* Happy path */}
        {!loading && quote && (
          <>
            {/* Gradient header: powered by Alex-IO + quote info + actions */}
            <div
              style={{
                margin: "-24px -24px 20px -24px",
                padding: "18px 24px 16px 24px",
                borderRadius: "24px 24px 0 0",
                background:
                  "linear-gradient(90deg,#0ea5e9 0%,#22d3ee 35%,#6366f1 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                color: "#e5e7eb",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    opacity: 0.95,
                    marginBottom: 4,
                  }}
                >
                  Powered by Alex-IO
                </div>
                <div
                  style={{
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                >
                  Interactive quote viewer
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    opacity: 0.96,
                  }}
                >
                  Quote {quote.quote_no}
                </div>
                <p
                  style={{
                    margin: "2px 0 0 0",
                    fontSize: 12,
                    opacity: 0.96,
                  }}
                >
                  {quote.customer_name}
                  {quote.email ? <> • {quote.email}</> : null}
                  {quote.phone ? <> • {quote.phone}</> : null}
                </p>
              </div>

              <div
                style={{
                  textAlign: "right",
                  fontSize: 12,
                  color: "#e5e7eb",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: "#eef2ff",
                    border: "1px solid #c7d2fe",
                    color: "#1d4ed8",
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {quote.status}
                </div>
                <p
                  style={{
                    margin: "6px 0 0 0",
                    fontSize: 11,
                    color: "#e5e7eb",
                    opacity: 0.95,
                  }}
                >
                  Created: {new Date(quote.created_at).toLocaleString()}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 10,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={handlePrint}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      color: "#0f172a",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Print this quote
                  </button>
                  <button
                    type="button"
                    onClick={handleForwardToSales}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      color: "#0f172a",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Forward to sales
                  </button>
                  <button
                    type="button"
                    onClick={handleScheduleCall}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      border: "1px solid #0f172a",
                      background: "#0f172a",
                      color: "#f9fafb",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Schedule a call
                  </button>
                </div>
              </div>
            </div>

            {/* TOP ROW: Specs / Pricing / Layout & next steps */}
            {primaryItem && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                  gap: 16,
                  marginBottom: 20,
                }}
              >
                {/* Specs card */}
                <div style={cardBase}>
                  <div style={cardTitleStyle}>Specs</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={labelStyle}>Dimensions</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {primaryItem.length_in} × {primaryItem.width_in} ×{" "}
                        {primaryItem.height_in} in
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Quantity</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {primaryItem.qty.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Material</div>
                      <div style={{ fontSize: 13, color: "#111827" }}>
                        {primaryItem.material_name ||
                          `Material #${primaryItem.material_id}`}
                      </div>
                    </div>
                  </div>
                </div>

            {/* LINE ITEMS (main test) */}
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Line items (main test)</h2>


            {items.length === 0 ? (
              <p style={{ color: "#6b7280" }}>
                No line items stored for this quote yet. Once the material and
                details are finalized, the primary line will appear here.
              </p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <thead>
                  <tr style={{ background: "#eff6ff" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Item
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Dimensions (L × W × H)
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Qty
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Unit price
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const dims =
                      item.length_in +
                      " × " +
                      item.width_in +
                      " × " +
                      item.height_in;
                    const label =
                      item.material_name || "Material #" + item.material_id;
                    const unit = parsePriceField(item.price_unit_usd ?? null);
                    const total = parsePriceField(item.price_total_usd ?? null);
                    return (
                      <tr key={item.id}>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          <div style={{ fontWeight: 500 }}>
                            Line {idx + 1}
                          </div>
                          <div style={{ color: "#6b7280" }}>{label}</div>
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          {dims}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                            textAlign: "right",
                          }}
                        >
                          {item.qty}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                            textAlign: "right",
                          }}
                        >
                          {formatUsd(unit)}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                            textAlign: "right",
                          }}
                        >
                          {formatUsd(total)}
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
                marginTop: 8,
              }}
            >
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Total quantity
                </div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  {overallQty}
                </div>
                {anyPricing && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        fontSize: 13,
                        color: "#111827",
                      }}
                    >
                      <div>
                        <div style={labelStyle}>Primary unit price</div>
                        <div>
                          {formatUsd(
                            parsePriceField(primaryItem.price_unit_usd ?? null),
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={labelStyle}>Estimated subtotal</div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>
                          {formatUsd(subtotal)}
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: "#6b7280",
                          lineHeight: 1.4,
                        }}
                      >
                        Final billing may adjust if specs, quantities, or
                        services change.
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        lineHeight: 1.5,
                      }}
                    >
                      Pricing is still being finalized for this quote. Once
                      pricing is applied, the per-piece and subtotal values will
                      appear here and in the line items below.
                    </div>
                  )}
                </div>

                {/* Layout & next steps card */}
                <div style={cardBase}>
                  <div style={cardTitleStyle}>Layout &amp; next steps</div>
                  <div
                    style={{
                      marginBottom: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "#eef2ff",
                      color: "#1d4ed8",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Interactive layout
                  </div>

                  {layoutPkg ? (
                    <>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#111827",
                          marginBottom: 4,
                        }}
                      >
                        A foam layout has been saved for this quote.
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginBottom: 8,
                          lineHeight: 1.4,
                        }}
                      >
                        You can open the layout editor from this page or from
                        your emailed quote to adjust pocket locations before
                        finalizing.
                      </div>
                      {notesPreview && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#4b5563",
                            background: "#eef2ff",
                            borderRadius: 10,
                            padding: "6px 8px",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>Notes: </span>
                          {notesPreview}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        lineHeight: 1.5,
                      }}
                    >
                      No foam layout has been saved yet. Use the layout editor
                      link in your emailed quote to place cavities where you’d
                      like your parts to sit, then click{" "}
                      <strong>Apply to quote</strong> to store the layout with
                      this quote.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LINE ITEMS CARD */}
            <div
              style={{
                ...cardBase,
                background: "#ffffff",
                marginBottom: 20,
                boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#0f172a",
                  marginBottom: 4,
                }}
              >
                Line items
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginBottom: 8,
                }}
              >
                These are the materials and quantities currently stored with your
                quote.
              </div>

              {items.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>
                  No line items stored for this quote yet. Once the material and
                  details are finalized, the primary line will appear here.
                </p>
              ) : (
                <>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                      marginBottom: 12,
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <thead>
                      {/* OBVIOUS TEST CHANGE: header row color now #eef2ff (indigo-tinted) */}
                      <tr style={{ background: "#eef2ff" }}>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          Item
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          Dimensions (L × W × H)
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          Qty
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          Unit price
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 8,
                            borderBottom: "1px solid #e5e7eb",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          Line total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const dims =
                          item.length_in +
                          " × " +
                          item.width_in +
                          " × " +
                          item.height_in;
                        const label =
                          item.material_name ||
                          "Material #" + item.material_id;
                        const unit = parsePriceField(
                          item.price_unit_usd ?? null,
                        );
                        const total = parsePriceField(
                          item.price_total_usd ?? null,
                        );
                        const rowBg =
                          idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                        return (
                          <tr key={item.id}>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                background: rowBg,
                              }}
                            >
                              <div style={{ fontWeight: 500, color: "#111827" }}>
                                Line {idx + 1}
                              </div>
                              <div style={{ color: "#6b7280", fontSize: 12 }}>
                                {label}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                background: rowBg,
                                color: "#111827",
                              }}
                            >
                              {dims}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                                background: rowBg,
                                color: "#111827",
                              }}
                            >
                              {item.qty}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                                background: rowBg,
                                color: "#111827",
                              }}
                            >
                              {formatUsd(unit)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #f3f4f6",
                                textAlign: "right",
                                background: rowBg,
                                color: "#111827",
                              }}
                            >
                              {formatUsd(total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: 4,
                    }}
                  >
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{ fontSize: 12, color: "#6b7280" }}
                      >
                        Total quantity
                      </div>
                      <div
                        style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}
                      >
                        {overallQty}
                      </div>
                      {anyPricing && (
                        <>
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: "#6b7280",
                            }}
                          >
                            Estimated subtotal
                          </div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              color: "#111827",
                            }}
                          >
                            {formatUsd(subtotal)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Foam layout package section */}
            <div style={{ marginTop: 4 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#0f172a",
                  marginBottom: 8,
                }}
              >
                Foam layout package
              </div>

              {!layoutPkg ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>
                  No foam layout has been saved for this quote yet. Use the{" "}
                  <strong>Open layout preview</strong> button in the emailed
                  quote to arrange cavities, then click{" "}
                  <strong>Apply to quote</strong> to store the layout here.
                </p>
              ) : (
                <div
                  style={{
                    ...cardBase,
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#111827",
                          marginBottom: 2,
                        }}
                      >
                        Layout package #{layoutPkg.id}
                      </div>
                      <div
                        style={{
                          color: "#6b7280",
                          fontSize: 12,
                        }}
                      >
                        Saved:{" "}
                        {new Date(layoutPkg.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div
                      style={{
                        textAlign: "right",
                        fontSize: 12,
                      }}
                    >
                      <a
                        href={
                          "/quote/layout?quote_no=" +
                          encodeURIComponent(quote.quote_no)
                        }
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          borderRadius: 999,
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
                        marginTop: 6,
                        color: "#4b5563",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>Notes: </span>
                      {notesPreview}
                    </div>
                  )}

                  {layoutPkg.svg_text &&
                    layoutPkg.svg_text.trim().length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 8,
                          borderRadius: 10,
                          border: "1px solid #e5e7eb",
                          background: "#ffffff",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: "#4b5563",
                            marginBottom: 6,
                          }}
                        >
                          Layout preview
                        </div>
                        <div
                          ref={svgContainerRef}
                          style={{
                            width: "100%",
                            height: 480,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 8,
                            border: "1px solid #e5e7eb",
                            background: "#f3f4f6",
                            overflow: "hidden",
                          }}
                          dangerouslySetInnerHTML={{
                            __html: layoutPkg.svg_text,
                          }}
                        />
                      </div>
                    )}
                </div>
              )}
            </div>

            <p
              style={{
                marginTop: 24,
                fontSize: 12,
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              This print view mirrors the core specs of your emailed quote.
              Actual charges may differ if specs or quantities change or if
              additional services are requested.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
