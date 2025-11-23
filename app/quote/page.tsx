// app/quote/page.tsx
//
// Print-friendly view of a quote by quote_no.
// URL pattern: /quote?quote_no=Q-AI-20251116-115613
//
// This is intentionally simple and tolerant: if items aren't stored yet,
// it still shows the header and a friendly "no line items stored" message.
// Now also shows the latest foam layout "package" (if any) saved via
// /api/quote/layout/apply, including inline SVG preview and download links.

import { q, one } from "@/lib/db";

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

export default async function QuotePage({
  searchParams,
}: {
  // Make this tolerant: accept any search param keys, including quote_no or quote
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // Support both ?quote_no= and ?quote= just like the layout editor
  const rawParam =
    (searchParams?.quote_no ??
      searchParams?.quote ??
      "") as string | string[] | undefined;

  const raw =
    Array.isArray(rawParam) && rawParam.length > 0
      ? rawParam[0]
      : ((rawParam as string) || "");

  const quoteNo = raw ? decodeURIComponent(raw) : "";

  if (!quoteNo) {
    return (
      <div
        style={{
          padding: "40px",
          fontFamily:
            "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
        }}
      >
        <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>
          Quote not found
        </h1>
        <p style={{ color: "#555" }}>
          We couldn&apos;t find a quote number in this link.
        </p>
      </div>
    );
  }

  const quote = await one<QuoteRow>(
    `
      select id, quote_no, customer_name, email, phone, status, created_at
      from quotes
      where quote_no = $1
    `,
    [quoteNo],
  );

  if (!quote) {
    return (
      <div
        style={{
          padding: "40px",
          fontFamily:
            "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
        }}
      >
        <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>
          Quote not found
        </h1>
        <p style={{ color: "#555" }}>
          We couldn&apos;t find a quote with number{" "}
          <code>{quoteNo}</code>.
        </p>
      </div>
    );
  }

  const items = await q<ItemRow>(
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

  // Latest foam layout package (if any) saved via /api/quote/layout/apply
  const layoutPkg = await one<LayoutPkgRow>(
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

  // We don't recompute exact pricing here yet (we can hook into /api/quotes/calc later if you like)
  const overallQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  // Helper: short preview of notes
  const notesPreview =
    layoutPkg?.notes && layoutPkg.notes.trim().length
      ? layoutPkg.notes.trim().length > 140
        ? layoutPkg.notes.trim().slice(0, 140) + "…"
        : layoutPkg.notes.trim()
      : null;

  // Data-URL download helpers for layout assets
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
            <p style={{ margin: "4px 0 0 0", color: "#4b5563" }}>
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
              Created: {new Date(quote.created_at).toLocaleString()}
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

        <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>
          Line items
        </h2>

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

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "8px",
          }}
        >
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              Total quantity
            </div>
            <div style={{ fontSize: "18px", fontWeight: 600 }}>
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
            <strong>Open layout preview</strong> button in the emailed
            quote to arrange cavities, then click <strong>Apply to
            quote</strong> to store the layout here.
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
                <div style={{ color: "#6b7280", fontSize: "12px" }}>
                  Saved:{" "}
                  {new Date(
                    layoutPkg.created_at,
                  ).toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: "12px" }}>
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
                <span style={{ fontWeight: 500 }}>Notes: </span>
                {notesPreview}
              </div>
            )}

            {/* Inline SVG preview, if we have one */}
            {layoutPkg.svg_text && layoutPkg.svg_text.trim().length > 0 && (
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
              {layoutPkg.dxf_text ? "stored" : "not generated yet"}{" "}
              · STEP export:{" "}
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
  );
}
