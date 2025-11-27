// app/admin/quotes/[quote_no]/AdminQuoteClient.tsx
//
// Internal admin quote viewer:
//  - Uses quote_no from props when available.
//  - If props are missing, rescues quote_no from window.location.pathname
//    (/admin/quotes/<quote_no>).
//  - Calls /api/quote/print to fetch:
//      - quote header
//      - items
//      - latest layout package (including svg_text / dxf_text / step_text)
//  - Renders a layout + CAD download section intended for internal use.
//
// IMPORTANT:
//  - This is an INTERNAL view (engineering / estimating).
//  - Client-facing /quote page remains CAD-download-free.
//  - We DO NOT touch cavity parsing, dims, qty logic, or existing /quote UI.

"use client";

import * as React from "react";

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

type Props = {
  quoteNo?: string;
};

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

export default function AdminQuoteClient({ quoteNo }: Props) {
  // Local quote number value: prefer prop, fall back to URL path.
  const [quoteNoValue, setQuoteNoValue] = React.useState<string>(
    quoteNo || "",
  );

  const [loading, setLoading] = React.useState<boolean>(!!quoteNoValue);
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState<string | null>(null);
  const [quoteState, setQuoteState] = React.useState<QuoteRow | null>(null);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(null);

  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  // 🔁 Rescue quote_no from URL path if prop is missing/empty.
  // Expected path: /admin/quotes/<quote_no>
  React.useEffect(() => {
    if (quoteNoValue) return;
    if (typeof window === "undefined") return;

    try {
      const path = window.location.pathname || "";
      const parts = path.split("/").filter(Boolean); // e.g. ["admin", "quotes", "Q-AI-..."]
      const idx = parts.findIndex((p) => p === "quotes");
      const fromPath =
        idx >= 0 && parts[idx + 1]
          ? decodeURIComponent(parts[idx + 1])
          : "";

      if (fromPath) {
        setQuoteNoValue(fromPath);
        setLoading(true);
        setNotFound(null);
        setError(null);
      } else {
        setLoading(false);
        setNotFound("No quote number provided in the URL.");
      }
    } catch {
      setLoading(false);
      setNotFound("No quote number provided in the URL.");
    }
  }, [quoteNoValue]);

  // Fetch quote data from /api/quote/print when we have a quote number.
  React.useEffect(() => {
    if (!quoteNoValue) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(null);
      setQuoteState(null);
      setItems([]);
      setLayoutPkg(null);

      try {
        const res = await fetch(
          "/api/quote/print?quote_no=" + encodeURIComponent(quoteNoValue),
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
            setQuoteState(json.quote);
            setItems(json.items || []);
            setLayoutPkg(json.layoutPkg || null);
          } else {
            setError("Unexpected response from quote API.");
          }
        }
      } catch (err) {
        console.error("Error fetching /api/quote/print (admin view):", err);
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
  }, [quoteNoValue]);

  const overallQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  const subtotal = items.reduce((sum, i) => {
    const lineTotal = parsePriceField(i.price_total_usd ?? null) ?? 0;
    return sum + lineTotal;
  }, 0);

  const anyPricing = subtotal > 0;

  const notesPreview =
    layoutPkg && layoutPkg.notes && layoutPkg.notes.trim().length > 0
      ? layoutPkg.notes.trim().length > 160
        ? layoutPkg.notes.trim().slice(0, 160) + "..."
        : layoutPkg.notes.trim()
      : null;

  // Normalize SVG preview (same as client-facing quote page)
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
      console.warn("Admin: could not normalize SVG preview:", e);
    }
  }, [layoutPkg]);

  const handleDownload = React.useCallback(
    (kind: "svg" | "dxf" | "step") => {
      if (typeof window === "undefined") return;
      if (!layoutPkg) return;

      let data: string | null = null;
      let ext = "";
      let mime = "";

      if (kind === "svg" && layoutPkg.svg_text) {
        data = layoutPkg.svg_text;
        ext = "svg";
        mime = "image/svg+xml";
      } else if (kind === "dxf" && layoutPkg.dxf_text) {
        data = layoutPkg.dxf_text;
        ext = "dxf";
        mime = "application/dxf";
      } else if (kind === "step" && layoutPkg.step_text) {
        data = layoutPkg.step_text;
        ext = "step";
        mime = "application/step";
      }

      if (!data) return;

      try {
        const blob = new Blob([data], { type: mime || "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const baseName = quoteState?.quote_no || "quote";
        a.download = `${baseName}-layout-${layoutPkg.id}.${ext || "txt"}`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Admin: download failed:", err);
      }
    },
    [layoutPkg, quoteState],
  );

  const primaryItem = items[0] || null;

  // shared card styles (aligned with client-facing quote page palette)
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

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#6b7280",
    marginBottom: 2,
  };

  return (
    <div
      style={{
        fontFamily:
          "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
        background: "#020617",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "24px",
          padding: "24px 24px 32px 24px",
          boxShadow: "0 16px 40px rgba(15,23,42,0.45)",
        }}
      >
        {/* Header: Admin badge + quote ID */}
        <div
          style={{
            margin: "-24px -24px 20px -24px",
            padding: "16px 24px",
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
                opacity: 0.9,
                marginBottom: 4,
              }}
            >
              Alex-IO internal
            </div>
            <div
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              Admin layout & CAD view
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                opacity: 0.94,
              }}
            >
              Quote {quoteNoValue || "—"}
            </div>
          </div>

          <div
            style={{
              textAlign: "right",
              fontSize: 12,
              color: "#e5e7eb",
            }}
          >
            {quoteState && (
              <>
                <div
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(15,23,42,0.2)",
                    border: "1px solid rgba(15,23,42,0.25)",
                    color: "#f9fafb",
                    fontWeight: 600,
                  }}
                >
                  {quoteState.status.toUpperCase()}
                </div>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: 11,
                    opacity: 0.9,
                  }}
                >
                  Created:{" "}
                  {new Date(quoteState.created_at).toLocaleString()}
                </p>
              </>
            )}
          </div>
        </div>

        {/* loading / errors */}
        {loading && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>
              Loading quote...
            </h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              Fetching quote + latest foam layout package.
            </p>
          </>
        )}

        {!loading && notFound && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>
              Quote not found
            </h1>
            <p style={{ color: "#555" }}>{notFound}</p>
          </>
        )}

        {!loading && error && !quoteState && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>
              Problem loading quote
            </h1>
            <p style={{ color: "#6b7280", fontSize: 13 }}>{error}</p>
          </>
        )}

        {/* main content */}
        {!loading && quoteState && (
          <>
            {/* top row: basic specs + quick pricing snapshot */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,2.2fr) minmax(0,1.8fr)",
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div style={cardBase}>
                <div style={cardTitleStyle}>Client & specs</div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    color: "#111827",
                  }}
                >
                  <div>
                    <div style={labelStyle}>Customer</div>
                    <div>
                      {quoteState.customer_name}
                      {quoteState.email ? <> • {quoteState.email}</> : null}
                      {quoteState.phone ? <> • {quoteState.phone}</> : null}
                    </div>
                  </div>
                  {primaryItem && (
                    <>
                      <div>
                        <div style={labelStyle}>
                          Primary dims (L × W × H)
                        </div>
                        <div>
                          {primaryItem.length_in} ×{" "}
                          {primaryItem.width_in} ×{" "}
                          {primaryItem.height_in} in
                        </div>
                      </div>
                      <div>
                        <div style={labelStyle}>Primary material</div>
                        <div>
                          {primaryItem.material_name ||
                            `Material #${primaryItem.material_id}`}
                        </div>
                      </div>
                      <div>
                        <div style={labelStyle}>Quoted quantity</div>
                        <div>{primaryItem.qty.toLocaleString()}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={cardBase}>
                <div style={cardTitleStyle}>Pricing snapshot</div>
                {items.length === 0 ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#6b7280",
                    }}
                  >
                    No stored line items yet. Once quote_items are written,
                    you&apos;ll see per-line pricing here.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      color: "#111827",
                    }}
                  >
                    <div>
                      <div style={labelStyle}>Lines</div>
                      <div>{items.length}</div>
                    </div>
                    <div>
                      <div style={labelStyle}>Total quantity</div>
                      <div>{overallQty}</div>
                    </div>
                    {anyPricing && (
                      <>
                        <div>
                          <div style={labelStyle}>Estimated subtotal</div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                            }}
                          >
                            {formatUsd(subtotal)}
                          </div>
                        </div>
                        {primaryItem && (
                          <div>
                            <div style={labelStyle}>
                              Primary unit price
                            </div>
                            <div>
                              {formatUsd(
                                parsePriceField(
                                  primaryItem.price_unit_usd ?? null,
                                ),
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {!anyPricing && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginTop: 4,
                        }}
                      >
                        Volumetric calc did not attach pricing. Check
                        material / dims / qty if you expect a value here.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* layout + CAD downloads */}
            <div
              style={{
                marginTop: 4,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#0f172a",
                  marginBottom: 8,
                }}
              >
                Foam layout & CAD exports
              </div>

              <div
                style={{
                  ...cardBase,
                  background: "#ffffff",
                }}
              >
                {!layoutPkg ? (
                  <p style={{ color: "#6b7280", fontSize: 13 }}>
                    No foam layout package has been stored for this quote
                    yet. Have the client use the layout editor from their
                    emailed quote and click <strong>Apply to quote</strong>.
                  </p>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 8,
                        gap: 12,
                        flexWrap: "wrap",
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
                          {new Date(
                            layoutPkg.created_at,
                          ).toLocaleString()}
                        </div>
                        {notesPreview && (
                          <div
                            style={{
                              marginTop: 6,
                              color: "#4b5563",
                              fontSize: 12,
                              background: "#eef2ff",
                              borderRadius: 10,
                              padding: "6px 8px",
                              maxWidth: 420,
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>
                              Notes:{" "}
                            </span>
                            {notesPreview}
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontSize: 12,
                          minWidth: 220,
                        }}
                      >
                        <div
                          style={{
                            marginBottom: 4,
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#6b7280",
                          }}
                        >
                          CAD downloads
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          {layoutPkg.svg_text &&
                            layoutPkg.svg_text.trim().length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleDownload("svg")}
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: 999,
                                  border: "1px solid #c7d2fe",
                                  background: "#eef2ff",
                                  color: "#1d4ed8",
                                  fontSize: 11,
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                Download SVG
                              </button>
                            )}
                          {layoutPkg.dxf_text &&
                            layoutPkg.dxf_text.trim().length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleDownload("dxf")}
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: 999,
                                  border: "1px solid #e5e7eb",
                                  background: "#f9fafb",
                                  color: "#111827",
                                  fontSize: 11,
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                Download DXF
                              </button>
                            )}
                          {layoutPkg.step_text &&
                            layoutPkg.step_text.trim().length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleDownload("step")}
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: 999,
                                  border: "1px solid #e5e7eb",
                                  background: "#f9fafb",
                                  color: "#111827",
                                  fontSize: 11,
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                Download STEP
                              </button>
                            )}
                        </div>
                      </div>
                    </div>

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
                              color: "#374151",
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
                  </>
                )}
              </div>
            </div>

            {/* optional: quick line items table (admin view) */}
            <div
              style={{
                ...cardBase,
                background: "#ffffff",
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
                Line items (admin view)
              </div>
              {items.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>
                  No line items stored for this quote.
                </p>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                    marginTop: 4,
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#eef2ff" }}>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 6,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Line
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 6,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Material
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 6,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Dims (L × W × H)
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: 6,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Qty
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: 6,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Unit
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: 6,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Total
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
                      return (
                        <tr key={item.id}>
                          <td
                            style={{
                              padding: 6,
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {idx + 1}
                          </td>
                          <td
                            style={{
                              padding: 6,
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {label}
                          </td>
                          <td
                            style={{
                              padding: 6,
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {dims}
                          </td>
                          <td
                            style={{
                              padding: 6,
                              borderBottom: "1px solid #f3f4f6",
                              textAlign: "right",
                            }}
                          >
                            {item.qty}
                          </td>
                          <td
                            style={{
                              padding: 6,
                              borderBottom: "1px solid #f3f4f6",
                              textAlign: "right",
                            }}
                          >
                            {formatUsd(unit)}
                          </td>
                          <td
                            style={{
                              padding: 6,
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
            </div>

            <p
              style={{
                marginTop: 24,
                fontSize: 11,
                color: "#6b7280",
                lineHeight: 1.4,
              }}
            >
              Internal-only view. Use this page for engineering review and
              CAD exports. Clients should continue to use the public
              /quote link in their email.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
