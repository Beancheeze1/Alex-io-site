// app/quote/page.tsx
//
// Print-friendly view of a quote by quote_no.
// URL pattern: /quote?quote_no=Q-AI-20251116-115613
//
// This is intentionally tolerant: even if we can't find a quote header
// in the DB, we still render the page and show the quote number pulled
// from the URL, plus a friendly notice.
//
// Also shows the latest foam layout "package" (if any) saved via
// /api/quote/layout/apply, including inline SVG preview and download links.

import Script from "next/script";
import { q, one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

type QuotePageSearchParams = {
  [key: string]: string | string[] | undefined;
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

const QUOTE_NO_SPAN_ID = "quote-no-display";

export default async function QuotePage({
  searchParams,
}: {
  searchParams?: QuotePageSearchParams;
}) {
  const qp = searchParams ?? {};

  // Try several possible query param names
  const rawParam =
    qp.quote_no ?? qp.quoteNo ?? qp.quote ?? qp.q ?? "";

  const raw =
    Array.isArray(rawParam) ? rawParam[0] ?? "" : rawParam ?? "";

  const quoteNoFromParams = raw ? decodeURIComponent(raw) : "";
  const hasQuoteNo = !!quoteNoFromParams;

  let quote: QuoteRow | null = null;
  let items: ItemRow[] = [];
  let layoutPkg: LayoutPkgRow | null = null;

  if (hasQuoteNo) {
    quote = await one<QuoteRow>(
      `
        select id, quote_no, customer_name, email, phone, status, created_at
        from quotes
        where quote_no = $1
      `,
      [quoteNoFromParams],
    );

    if (quote) {
      items = await q<ItemRow>(
        `
          select
            qi.id,
            qi.quote_id,
            qi.length_in::text,
            qi.width_in::text,
            qi.height_in::text,
            qi.qty,
            qi.material_id,
            m.name as material_name
          from quote_items qi
          left join materials m on m.id = qi.material_id
          where qi.quote_id = $1
          order by qi.id asc
        `,
        [quote.id],
      );

      layoutPkg = await one<LayoutPkgRow>(
        `
          select
            id,
            quote_id,
            layout_json,
            notes,
            svg_text,
            dxf_text,
            step_text,
            created_at
          from quote_layout_packages
          where quote_id = $1
          order by created_at desc
          limit 1
        `,
        [quote.id],
      );
    }
  }

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

  // What we show initially in the "Quote # ..." line
  const displayQuoteNo =
    quote?.quote_no || quoteNoFromParams || "Q-AI-EXAMPLE";

  // Client helper: once in the browser, read quote_no from URL
  // and patch the span so it always matches the address bar
  const clientQuoteScript = `
    (function () {
      try {
        var el = document.getElementById(${JSON.stringify(
          QUOTE_NO_SPAN_ID,
        )});
        if (!el) return;
        var url = new URL(window.location.href);
        var q =
          url.searchParams.get("quote_no") ||
          url.searchParams.get("quote") ||
          url.searchParams.get("quoteNo") ||
          url.searchParams.get("q");
        if (q && typeof q === "string" && q.trim()) {
          el.textContent = q.trim();
        }
      } catch (e) {
        console.error("quote_no client helper failed", e);
      }
    })();
  `;

  return (
    <>
      {/* Sync visible Quote # with URL in the browser */}
      <Script
        id="quote-no-sync"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: clientQuoteScript }}
      />

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
          {/* ---------- Header ---------- */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: "22px" }}>
                Quote #
                <span
                  id={QUOTE_NO_SPAN_ID}
                  style={{ marginLeft: "4px" }}
                >
                  {displayQuoteNo}
                </span>
              </h1>

              {!hasQuoteNo && (
                <p
                  style={{
                    margin: "6px 0 0 0",
                    color: "#9ca3af",
                    fontSize: "12px",
                  }}
                >
                  We couldn&apos;t detect a quote number in this link.
                  The visible quote number will update if <code>quote_no</code>{" "}
                  is present in the URL.
                </p>
              )}

              {hasQuoteNo && !quote && (
                <p
                  style={{
                    margin: "6px 0 0 0",
                    color: "#9ca3af",
                    fontSize: "12px",
                  }}
                >
                  We couldn&apos;t find a quote header in the database for this
                  number. This print view is still usable for layout reference
                  and sharing.
                </p>
              )}

              {quote && (
                <>
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
                </>
              )}
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
                  background: quote
                    ? quote.status === "sent"
                      ? "#d1fae5"
                      : quote.status === "accepted"
                      ? "#bfdbfe"
                      : "#e5e7eb"
                    : "#e5e7eb",
                  color: quote
                    ? quote.status === "sent"
                      ? "#065f46"
                      : quote.status === "accepted"
                      ? "#1d4ed8"
                      : "#374151"
                    : "#374151",
                }}
              >
                {quote
                  ? quote.status.toUpperCase()
                  : "STATUS UNKNOWN"}
              </div>
              <div style={{ marginTop: "8px" }}>
                <span style={{ color: "#9ca3af" }}>
                  Use your browser&apos;s <strong>Print</strong> command to
                  print this page.
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

          {/* ---------- Line items ---------- */}
          <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>
            Line items
          </h2>

          {!quote ? (
            <p style={{ color: "#6b7280" }}>
              Because the quote header wasn&apos;t found, there are no stored
              line items to show. Once this quote is created in the system, its
              material line will appear here.
            </p>
          ) : items.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No line items stored for this quote yet. Once the material and
              details are finalized, the primary line will appear here.
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
                    item.material_name || `Material #${item.material_id}`;
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
                        <div style={{ color: "#6b7280" }}>{label}</div>
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

          {quote && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "8px",
              }}
            >
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#6b7280",
                  }}
                >
                  Total quantity
                </div>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 600,
                  }}
                >
                  {overallQty}
                </div>
              </div>
            </div>
          )}

          {/* ---------- Foam layout package ---------- */}
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

          {!quote ? (
            <p style={{ color: "#6b7280", fontSize: "13px" }}>
              Once this quote exists in the system and a foam layout is
              applied, the latest layout package will be shown here (including
              SVG preview and downloads).
            </p>
          ) : !layoutPkg ? (
            <p style={{ color: "#6b7280", fontSize: "13px" }}>
              No foam layout has been saved for this quote yet. Use the{" "}
              <strong>Open layout preview</strong> button in the emailed
              quote to arrange cavities, then click <strong>Apply to quote</strong>{" "}
              to store the layout here.
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
                      displayQuoteNo,
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
                  <span style={{ fontWeight: 500 }}>Notes: </span>
                  {notesPreview}
                </div>
              )}

              {layoutPkg?.svg_text && layoutPkg.svg_text.trim().length > 0 && (
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

    {/* IMPORTANT: these parentheses avoid template literal issues */}
    <div
      style={{
        width: "100%",
        maxHeight: "260px",
        overflow: "hidden",
        borderRadius: "8px",
        border: "1px solid #e5e7eb",
        background: "#f3f4f6",
      }}
      dangerouslySetInnerHTML={{ __html: layoutPkg.svg_text }}
    />
  </div>
)}


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
                    download={`quote-${displayQuoteNo}-layout.svg`}
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
                    download={`quote-${displayQuoteNo}-layout.dxf`}
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
                    download={`quote-${displayQuoteNo}-layout.step`}
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
                {layoutPkg.dxf_text ? "stored" : "not generated yet"} · STEP
                export:{" "}
                {layoutPkg.step_text ? "stored" : "not generated yet"}
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
            This print view mirrors the core specs of your emailed quote.
            Actual charges may differ if specs or quantities change or if
            additional services are requested.
          </p>
        </div>
      </div>
    </>
  );
}
