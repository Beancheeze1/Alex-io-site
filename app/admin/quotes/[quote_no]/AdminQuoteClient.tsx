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
  qty: number | string | null;
  material_id: number;
  material_name: string | null;

  // NEW: carry-through from /api/quote/print
  material_family?: string | null;
  density_lb_ft3?: number | string | null;

  price_unit_usd?: string | number | null;
  price_total_usd?: string | number | null;

  // NEW: richer pricing metadata from /api/quote/print
  pricing_meta?: {
    min_charge?: number | null;
    used_min_charge?: boolean;
    setup_fee?: number | null;
    kerf_pct?: number | null;
  } | null;
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

// NEW: requested cartons (quote_box_selections + boxes join) for this quote

type RequestedBoxRow = {
  id: number; // row id from quote_box_selections
  quote_id: number;
  box_id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  qty: number | string | null;
};

type BoxesForQuoteOk = {
  ok: true;
  selections: RequestedBoxRow[];
};

type BoxesForQuoteErr = {
  ok: false;
  error: string;
};

type BoxesForQuoteResponse = BoxesForQuoteOk | BoxesForQuoteErr;

function parsePriceField(
  raw: string | number | null | undefined,
): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

// NEW: safe numeric parser for quantities / counts / densities
function toNumberSafe(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

// NEW: safe formatter for integer-ish quantities
function formatQty(raw: any): string {
  const n = toNumberSafe(raw);
  if (n === null) return "—";
  try {
    return n.toLocaleString("en-US");
  } catch {
    return String(n);
  }
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
  const [layoutPkg, setLayoutPkg] = React.useState<LayoutPkgRow | null>(
    null,
  );

  const svgContainerRef = React.useRef<HTMLDivElement | null>(null);

  // NEW: requested cartons for this quote (from quote_box_selections)
  const [boxSelections, setBoxSelections] = React.useState<
    RequestedBoxRow[] | null
  >(null);
  const [boxSelectionsLoading, setBoxSelectionsLoading] =
    React.useState<boolean>(false);
  const [boxSelectionsError, setBoxSelectionsError] =
    React.useState<string | null>(null);

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
            if (!json.ok && (json as ApiErr).error === "NOT_FOUND") {
              setNotFound((json as ApiErr).message || "Quote not found.");
            } else if (!json.ok) {
              setError(
                (json as ApiErr).message ||
                  "There was a problem loading this quote.",
              );
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

  // NEW: Fetch requested cartons (quote_box_selections) for this quote
  React.useEffect(() => {
    if (!quoteNoValue) return;

    let cancelled = false;

    async function loadRequestedBoxes() {
      setBoxSelectionsLoading(true);
      setBoxSelectionsError(null);
      setBoxSelections(null);

      try {
        const res = await fetch(
          "/api/boxes/for-quote?quote_no=" +
            encodeURIComponent(quoteNoValue),
          { cache: "no-store" },
        );

        const json = (await res.json()) as BoxesForQuoteResponse;

        if (!res.ok || !json.ok) {
          if (!cancelled) {
            const msg =
              (!json.ok && (json as BoxesForQuoteErr).error) ||
              "Unable to load requested cartons for this quote.";
            setBoxSelectionsError(msg);
          }
          return;
        }

        if (!cancelled) {
          setBoxSelections(json.selections || []);
        }
      } catch (err) {
        console.error(
          "Error fetching /api/boxes/for-quote (admin view):",
          err,
        );
        if (!cancelled) {
          setBoxSelectionsError(
            "Unable to load requested cartons for this quote.",
          );
        }
      } finally {
        if (!cancelled) {
          setBoxSelectionsLoading(false);
        }
      }
    }

    loadRequestedBoxes();

    return () => {
      cancelled = true;
    };
  }, [quoteNoValue]);

  // === derived numbers / text ===============================================

  const overallQty = items.reduce((sum, i) => {
    const qtyNum = toNumberSafe(i.qty);
    return sum + (qtyNum ?? 0);
  }, 0);

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

  // NEW: unpack richer pricing info for quick engineering context
  const primaryPricing = primaryItem?.pricing_meta || null;
  const minChargeApplied = !!primaryPricing?.used_min_charge;
  const setupFee =
    typeof primaryPricing?.setup_fee === "number"
      ? primaryPricing.setup_fee
      : null;
  const kerfPct =
    typeof primaryPricing?.kerf_pct === "number"
      ? primaryPricing.kerf_pct
      : null;
  const minChargeValue =
    typeof primaryPricing?.min_charge === "number"
      ? primaryPricing.min_charge
      : null;

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

  // NEW: derived material fields for the explorer card
  const primaryMaterialName =
    primaryItem?.material_name ||
    (primaryItem ? `Material #${primaryItem.material_id}` : null);
  const primaryMaterialFamily = primaryItem?.material_family || null;

  // density as a clean number (handles string-from-DB cases)
  const primaryDensity = toNumberSafe(primaryItem?.density_lb_ft3 ?? null);

  const customerQuoteUrl =
    quoteState?.quote_no && typeof window === "undefined"
      ? `/quote?quote_no=${encodeURIComponent(quoteState.quote_no)}`
      : quoteState?.quote_no
      ? `/quote?quote_no=${encodeURIComponent(quoteState.quote_no)}`
      : null;

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
        {/* Back link to quotes list */}
        <div style={{ marginBottom: 8 }}>
          <a
            href="/admin/quotes"
            style={{
              fontSize: 11,
              color: "#0284c7",
              textDecoration: "none",
            }}
          >
            ← Back to quotes list
          </a>
        </div>

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
                          {primaryMaterialName ||
                            `Material #${primaryItem.material_id}`}
                        </div>
                      </div>
                      <div>
                        <div style={labelStyle}>Quoted quantity</div>
                        <div>{formatQty(primaryItem.qty)}</div>
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
                      <div>{formatQty(overallQty)}</div>
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
                        {/* NEW: tiny internal-only context about how pricing was built */}
                        {primaryPricing && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "#6b7280",
                              lineHeight: 1.5,
                            }}
                          >
                            <span>
                              Calc basis: volumetric foam charge with{" "}
                              {typeof kerfPct === "number"
                                ? `~${kerfPct}% kerf/waste`
                                : "standard kerf/waste"}
                              .
                              {setupFee && setupFee > 0
                                ? ` Includes a setup fee of ${formatUsd(
                                    setupFee,
                                  )}.`
                                : ""}{" "}
                              {minChargeApplied
                                ? ` Pricing is currently governed by the minimum charge (${formatUsd(
                                    minChargeValue ?? subtotal,
                                  )}), not the raw volume math.`
                                : " Minimum charge is not the limiting factor for this configuration."}
                            </span>
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

            {/* NEW: Materials explorer + "view customer quote" */}
            {primaryItem && (
              <div
                style={{
                  ...cardBase,
                  background: "#ffffff",
                  marginBottom: 20,
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(0,2.2fr) minmax(0,1.8fr)",
                  gap: 16,
                }}
              >
                <div>
                  <div style={cardTitleStyle}>Materials explorer</div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#111827",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div>
                      <div style={labelStyle}>Primary material</div>
                      <div>{primaryMaterialName}</div>
                    </div>
                    <div>
                      <div style={labelStyle}>Family</div>
                      <div>
                        {primaryMaterialFamily || (
                          <span style={{ color: "#9ca3af" }}>
                            Unassigned (set in materials admin)
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Density</div>
                      <div>
                        {primaryDensity != null
                          ? `${primaryDensity.toFixed(2)} pcf`
                          : "—"}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      Family + density come directly from the{" "}
                      <span
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, monospace",
                          fontSize: 11,
                          color: "#0369a1",
                        }}
                      >
                        materials
                      </span>{" "}
                      table. Polyethylene and Expanded Polyethylene remain
                      separate families.
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 12,
                    color: "#111827",
                  }}
                >
                  <div>
                    <div style={labelStyle}>Admin shortcuts</div>
                    <ul
                      style={{
                        listStyle: "disc",
                        paddingLeft: 18,
                        marginTop: 4,
                        marginBottom: 4,
                        color: "#1f2937",
                        fontSize: 12,
                      }}
                    >
                      <li>
                        <a
                          href="/admin/materials"
                          style={{
                            color: "#0369a1",
                            textDecoration: "none",
                          }}
                        >
                          Open materials catalog
                        </a>{" "}
                        to confirm family / density.
                      </li>
                      <li>
                        <a
                          href={`/admin/cushion-curves/${primaryItem.material_id}`}
                          style={{
                            color: "#0369a1",
                            textDecoration: "none",
                          }}
                        >
                          View cushion curves for this material
                        </a>{" "}
                        (foam advisor data).
                      </li>
                    </ul>
                  </div>

                  {customerQuoteUrl && (
                    <div
                      style={{
                        marginTop: 4,
                        paddingTop: 6,
                        borderTop: "1px dashed #e5e7eb",
                      }}
                    >
                      <div style={labelStyle}>Customer-facing view</div>
                      <a
                        href={customerQuoteUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 2,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid #0ea5e9",
                          background: "#e0f2fe",
                          color: "#0369a1",
                          fontSize: 11,
                          fontWeight: 500,
                          textDecoration: "none",
                        }}
                      >
                        View customer quote in new tab
                        <span aria-hidden="true">↗</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* NEW: Customer requested cartons (admin-only view) */}
            <div
              style={{
                ...cardBase,
                background: "#ffffff",
                marginBottom: 20,
              }}
            >
              <div style={cardTitleStyle}>Customer requested cartons</div>
              {boxSelectionsLoading && (
                <p style={{ fontSize: 12, color: "#6b7280" }}>
                  Looking up any cartons the customer marked as{" "}
                  <strong>Requested</strong> from the quote viewer…
                </p>
              )}
              {!boxSelectionsLoading && boxSelectionsError && (
                <p style={{ fontSize: 12, color: "#b91c1c" }}>
                  {boxSelectionsError}
                </p>
              )}
              {!boxSelectionsLoading &&
                !boxSelectionsError &&
                (!boxSelections || boxSelections.length === 0) && (
                  <p style={{ fontSize: 12, color: "#6b7280" }}>
                    No cartons have been requested on this quote yet from
                    the customer-facing /quote page.
                  </p>
                )}
              {!boxSelectionsLoading &&
                !boxSelectionsError &&
                boxSelections &&
                boxSelections.length > 0 && (
                  <>
                    <p
                      style={{
                        fontSize: 12,
                        color: "#4b5563",
                        marginBottom: 6,
                      }}
                    >
                      These selections come from the public quote viewer
                      when the customer clicks{" "}
                      <strong>
                        &ldquo;Add this carton to my quote&rdquo;
                      </strong>
                      . Use this list as a heads-up when finalizing
                      packaging and placing box orders.
                    </p>
                    <ul
                      style={{
                        listStyle: "disc",
                        paddingLeft: 18,
                        margin: 0,
                        fontSize: 12,
                        color: "#111827",
                      }}
                    >
                      {boxSelections.map((sel) => {
                        const metaParts: string[] = [];
                        if (sel.vendor) metaParts.push(sel.vendor);
                        if (sel.style) metaParts.push(sel.style);
                        if (sel.sku) metaParts.push(sel.sku);

                        return (
                          <li
                            key={sel.id}
                            style={{ marginBottom: 4 }}
                          >
                            <div style={{ fontWeight: 500 }}>
                              {sel.description || sel.sku}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#6b7280",
                              }}
                            >
                              {metaParts.join(" • ")} — Qty{" "}
                              {formatQty(sel.qty)}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: "#9ca3af",
                      }}
                    >
                      Read-only mirror of{" "}
                      <span
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, monospace",
                        }}
                      >
                        quote_box_selections
                      </span>
                      . Changing cartons or quantities still happens via
                      your normal quoting workflow.
                    </p>
                  </>
                )}
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

              {/* NEW: lightweight layout activity panel (latest package) */}
              {layoutPkg && (
                <div
                  style={{
                    ...cardBase,
                    background: "#ffffff",
                    marginTop: 12,
                  }}
                >
                  <div style={cardTitleStyle}>Layout activity</div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "#4b5563",
                      marginBottom: 4,
                    }}
                  >
                    Latest layout package is{" "}
                    <strong>#{layoutPkg.id}</strong>, saved on{" "}
                    {new Date(layoutPkg.created_at).toLocaleString()}.
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: "#9ca3af",
                    }}
                  >
                    Future upgrade: once a history API is wired, this panel
                    will list multiple layout revisions with timestamps.
                  </p>
                </div>
              )}
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
                            {formatQty(item.qty)}
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
