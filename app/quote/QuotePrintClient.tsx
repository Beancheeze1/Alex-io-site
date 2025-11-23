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
//   - Quote overview (specs from primary line item)
//   - Line items table (now with pricing)
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
  // NEW: pricing fields from /api/quote/print
  price_unit_usd: string | number | null;
  price_total_usd: string | number | null;
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

// ----- helpers for pricing display -----

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
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(null);

  // Ref to the SVG preview container so we can scale/center the inner <svg>
  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Print handler for the button
  const handlePrint = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.print();
    }
  }, []);

  // Forward to sales handler (mailto with quote link)
  const handleForwardToSales = React.useCallback(() => {
    if (typeof window === "undefined") return;

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

  // Schedule call handler (opens Calendly or similar)
  const handleScheduleCall = React.useCallback(() => {
    if (typeof window === "undefined") return;

    // TODO: replace this with your real Calendly link
    const url =
      (process.env.NEXT_PUBLIC_SCHEDULE_CALL_URL as string | undefined) ||
      "https://calendly.com/your-company/30min";

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // Rescue: if we still do not have quoteNo from router, read window.location
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

  // Fetch quote data when quoteNo is known
  React.useEffect(() => {
    if (!quoteNo) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(null);

      try {
        const res = await fetch(`/api/quote/print?quote_no=${encodeURIComponent(quoteNo)}`);

        if (!res.ok) {
          if (res.status === 404) {
            const json = (await res.json()) as ApiErr;
            if (!cancelled) {
              setNotFound(json.message || "Quote not found.");
            }
            return;
          }

          const text = await res.text();
          console.error("Unexpected /api/quote/print response:", res.status, text);
          if (!cancelled) {
            setError("Unexpected error while loading the quote.");
          }
          return;
        }

        const json = (await res.json()) as ApiResponse;

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
        console.error("Error fetching quote:", err);
        if (!cancelled) {
          setError("There was a problem fetching this quote. Please try again.");
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

  // NEW: subtotal from DB pricing and flag if we have any pricing at all
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

  // After the SVG is injected, scale and center it inside the preview box
  React.useEffect(() => {
    if (!layoutPkg) return;
    if (!svgContainerRef.current) return;

    const svgEl = svgContainerRef.current.querySelector("svg") as
      | SVGSVGElement
      | null;
    if (!svgEl) return;

    const container = svgContainerRef.current;
    const containerRect = container.getBoundingClientRect();

    const vb = svgEl.viewBox.baseVal;
    const svgWidth = vb && vb.width ? vb.width : svgEl.getBBox().width;
    const svgHeight = vb && vb.height ? vb.height : svgEl.getBBox().height;
    if (!svgWidth || !svgHeight) return;

    const scale = Math.min(
      containerRect.width / svgWidth,
      containerRect.height / svgHeight,
    );

    svgEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
    svgEl.style.transformOrigin = "50% 50%";
  }, [layoutPkg]);

  return (
    <div
      style={{
        fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
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
        {/* No quote number at all */}
        {!quoteNo && !loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#555" }}>
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
              Please wait while we load your quote details.
            </p>
          </>
        )}

        {/* Quote not found (API 404) */}
        {!loading && notFound && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Quote not found</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>{notFound}</p>
          </>
        )}

        {/* Generic error */}
        {!loading && !notFound && error && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Error loading quote</h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              There was an error while loading this quote.
            </p>
            <p style={{ color: "#6b7280", fontSize: 13 }}>{error}</p>
          </>
        )}

        {/* Happy path */}
        {!loading && quote && (
          <>
            {/* HEADER: quote info + actions */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 16,
                gap: 16,
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontSize: 22 }}>
                  Quote #{quote.quote_no}
                </h1>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    color: "#4b5563",
                  }}
                >
                  {quote.customer_name}
                  {quote.email ? <> • {quote.email}</> : null}
                  {quote.phone ? <> • {quote.phone}</> : null}
                </p>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: 12,
                    color: "#6b7280",
                  }}
                >
                  Created{" "}
                  {new Date(quote.created_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 10px",
                    borderRadius: 999,
                    background:
                      quote.status === "open"
                        ? "#ecfdf3"
                        : quote.status === "closed"
                        ? "#eff6ff"
                        : "#fef3c7",
                    color:
                      quote.status === "open"
                        ? "#166534"
                        : quote.status === "closed"
                        ? "#1d4ed8"
                        : "#92400e",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {quote.status.toUpperCase()}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={handlePrint}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      background: "#f9fafb",
                      color: "#111827",
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
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #bfdbfe",
                      background: "#eff6ff",
                      color: "#1d4ed8",
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
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #1d4ed8",
                      background: "#1d4ed8",
                      color: "#ffffff",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Schedule a call
                  </button>
                </div>
              </div>
            </div>

            {/* BODY GRID */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.4fr",
                gap: 24,
                alignItems: "flex-start",
              }}
            >
              {/* Left column: overview + items */}
              <div>
                {/* Overview from primary line item */}
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    padding: 16,
                    marginBottom: 16,
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                      color: "#6b7280",
                      marginBottom: 8,
                    }}
                  >
                    Overview
                  </div>

                  {items.length === 0 ? (
                    <p style={{ color: "#6b7280", fontSize: 13 }}>
                      No line items stored for this quote yet.
                    </p>
                  ) : (
                    (() => {
                      const primaryItem = items[0];
                      const dims =
                        primaryItem.length_in +
                        " × " +
                        primaryItem.width_in +
                        " × " +
                        primaryItem.height_in;

                      return (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                            gap: 12,
                            fontSize: 13,
                            color: "#111827",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                                color: "#6b7280",
                                marginBottom: 2,
                              }}
                            >
                              Dimensions
                            </div>
                            <div>{dims} in</div>
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                                color: "#6b7280",
                                marginBottom: 2,
                              }}
                            >
                              Quantity
                            </div>
                            <div>{primaryItem.qty.toLocaleString()}</div>
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                                color: "#6b7280",
                                marginBottom: 2,
                              }}
                            >
                              Material
                            </div>
                            <div>
                              {primaryItem.material_name ||
                                "Material #" + primaryItem.material_id}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>

                {/* Line items table with pricing */}
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                      color: "#6b7280",
                      marginBottom: 8,
                    }}
                  >
                    Line items
                  </div>

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
                          {/* NEW: pricing columns */}
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
                            item.material_name ||
                            "Material #" + item.material_id;

                          const unit = parsePriceField(item.price_unit_usd);
                          const total = parsePriceField(item.price_total_usd);

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

                  {/* Totals row: quantity + subtotal */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 24,
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
                    </div>
                    {anyPricing && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          Estimated subtotal
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>
                          {formatUsd(subtotal)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right column: layout preview */}
              <div>
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                      color: "#6b7280",
                      marginBottom: 8,
                    }}
                  >
                    Foam layout
                  </div>

                  {!layoutPkg && (
                    <p style={{ color: "#6b7280", fontSize: 13 }}>
                      No layout package has been saved for this quote yet. Once
                      the layout is finalized in the editor, it will appear
                      here.
                    </p>
                  )}

                  {layoutPkg && (
                    <>
                      {notesPreview && (
                        <p
                          style={{
                            color: "#374151",
                            fontSize: 13,
                            marginBottom: 12,
                          }}
                        >
                          {notesPreview}
                        </p>
                      )}
                      <div
                        ref={svgContainerRef}
                        style={{
                          position: "relative",
                          width: "100%",
                          paddingTop: "75%",
                          overflow: "hidden",
                          background: "#f9fafb",
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                        }}
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{
                          __html: layoutPkg.svg_text || "",
                        }}
                      />
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                          }}
                        >
                          Saved:{" "}
                          {new Date(
                            layoutPkg.created_at,
                          ).toLocaleString()}
                        </div>
                        <div
                          style={{
                            textAlign: "right",
                            fontSize: 12,
                          }}
                        >
                          {/* No download buttons here on purpose */}
                          Layout preview only
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <p
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "#6b7280",
                    lineHeight: 1.5,
                  }}
                >
                  This print view mirrors the core specs and pricing of your
                  emailed quote. Final charges may differ if specs or quantities
                  change, or if additional services are requested.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
