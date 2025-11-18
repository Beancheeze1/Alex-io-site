// app/quote/[quote_no]/page.tsx
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
  length_in: number;
  width_in: number;
  height_in: number;
  material_id: number;
  qty: number;
  material_name: string | null;
};

type CavityRow = {
  quote_item_id: number;
  label: string | null;
  count: number | null;
  cav_length_in: string | null;
  cav_width_in: string | null;
  cav_depth_in: string | null;
};

type CalcResult = {
  price_total?: number | null;
  total?: number | null;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  min_charge_applied?: boolean | null;
};

function usd(n: number): string {
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

export default async function QuotePrintPage(props: { params: { quote_no: string } }) {
  const raw = props.params.quote_no || "";
  const quoteNo = decodeURIComponent(raw);

  const quote = await one<QuoteRow>(
    `
    select id, quote_no, customer_name, email, phone, status, created_at
    from quotes
    where quote_no = $1
    limit 1;
    `,
    [quoteNo]
  );

  if (!quote) {
    return (
      <div
        style={{
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "40px",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px" }}>Quote not found</h1>
        <p style={{ color: "#6b7280" }}>We couldn&apos;t find a quote with number {quoteNo}.</p>
      </div>
    );
  }

  const items = await q<ItemRow>(
    `
    select
      qi.id,
      qi.quote_id,
      qi.length_in,
      qi.width_in,
      qi.height_in,
      qi.material_id,
      qi.qty,
      m.name as material_name
    from quote_items qi
    left join materials m on m.id = qi.material_id
    where qi.quote_id = $1
    order by qi.id asc;
    `,
    [quote.id]
  );

  const itemIds = items.map((i) => i.id);
  let cavityMap = new Map<number, CavityRow[]>();

  if (itemIds.length) {
    const cavities = await q<CavityRow>(
      `
      select
        quote_item_id,
        label,
        count,
        cav_length_in::text,
        cav_width_in::text,
        cav_depth_in::text
      from quote_item_cavities
      where quote_item_id = any($1::int[])
      order by quote_item_id, label;
      `,
      [itemIds]
    );

    for (const cav of cavities) {
      const arr = cavityMap.get(cav.quote_item_id) || [];
      arr.push(cav);
      cavityMap.set(cav.quote_item_id, arr);
    }
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const priced = await Promise.all(
    items.map(async (item) => {
      const cavs = cavityMap.get(item.id) || [];
      const cavStrings = cavs
        .map((c) => {
          const L = c.cav_length_in || "";
          const W = c.cav_width_in || "";
          const H = c.cav_depth_in || "";
          if (!L || !W || !H) return null;
          return `${L}x${W}x${H}`;
        })
        .filter((x): x is string => !!x);

      let calc: CalcResult | null = null;
      try {
        const res = await fetch(`${base}/api/quotes/calc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            length_in: item.length_in,
            width_in: item.width_in,
            height_in: item.height_in,
            material_id: item.material_id,
            qty: item.qty,
            cavities: cavStrings,
            round_to_bf: false,
          }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (res.ok && data?.ok && data.result) {
          calc = data.result;
        }
      } catch {
        // ignore pricing errors in print view
      }

      return { item, calc };
    })
  );

  const overallTotal = priced.reduce((sum, row) => {
    const t =
      row.calc?.price_total ??
      row.calc?.total ??
      0;
    return sum + (typeof t === "number" && isFinite(t) ? t : 0);
  }, 0);

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
            alignItems: "flex-start",
            marginBottom: "24px",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#6b7280" }}>
              Quote
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700 }}>{quote.quote_no}</div>
            <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
              Created {new Date(quote.created_at).toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>{quote.customer_name}</div>
            {quote.email && (
              <div style={{ fontSize: "13px", color: "#6b7280" }}>{quote.email}</div>
            )}
            {quote.phone && (
              <div style={{ fontSize: "13px", color: "#6b7280" }}>{quote.phone}</div>
            )}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 500,
                marginTop: "8px",
                background:
                  quote.status === "sent"
                    ? "rgba(59,130,246,0.08)"
                    : quote.status === "accepted"
                    ? "rgba(34,197,94,0.08)"
                    : quote.status === "lost"
                    ? "rgba(248,113,113,0.08)"
                    : "rgba(148,163,184,0.12)",
                color:
                  quote.status === "sent"
                    ? "#1d4ed8"
                    : quote.status === "accepted"
                    ? "#15803d"
                    : quote.status === "lost"
                    ? "#b91c1c"
                    : "#475569",
              }}
            >
              {quote.status || "draft"}
            </div>
          </div>
        </div>

        <div
          style={{
            marginBottom: "16px",
            padding: "12px 14px",
            borderRadius: "12px",
            background: "#eff6ff",
            border: "1px solid #dbeafe",
            fontSize: "13px",
            color: "#1d4ed8",
          }}
        >
          This printable view is for internal use and for sharing with customers who prefer a PDF
          style summary. Prices are based on the specs below.
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "8px",
            fontSize: "13px",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "8px",
                  borderBottom: "1px solid #e5e7eb",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Line
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "8px",
                  borderBottom: "1px solid #e5e7eb",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Dimensions
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "8px",
                  borderBottom: "1px solid #e5e7eb",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Qty
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "8px",
                  borderBottom: "1px solid #e5e7eb",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Est. Total
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.map(({ item, calc }, idx) => {
              const label = item.material_name || `Material #${item.material_id}`;
              const dims = `${item.length_in} × ${item.width_in} × ${item.height_in}`;
              const total =
                calc?.price_total ??
                calc?.total ??
                null;
              const cavs = cavityMap.get(item.id) || [];
              return (
                <tr key={item.id}>
                  <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                    <div style={{ fontWeight: 500 }}>Line {idx + 1}</div>
                    <div style={{ color: "#6b7280" }}>{label}</div>
                    {cavs.length > 0 && (
                      <div style={{ marginTop: "4px", fontSize: "11px", color: "#4b5563" }}>
                        Cavities:{" "}
                        {cavs
                          .map((c) => {
                            const L = c.cav_length_in || "";
                            const W = c.cav_width_in || "";
                            const H = c.cav_depth_in || "";
                            const count = c.count ?? 1;
                            if (!L || !W || !H) return null;
                            const base = `${L}x${W}x${H}`;
                            return count > 1 ? `${count}× ${base}` : base;
                          })
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6" }}>{dims}</td>
                  <td
                    style={{
                      padding: "8px",
                      borderBottom: "1px solid #f3f4f6",
                      textAlign: "right",
                    }}
                  >
                    {item.qty}
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      borderBottom: "1px solid #f3f4f6",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {total != null ? usd(total) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div
          style={{
            marginTop: "18px",
            paddingTop: "12px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "13px", color: "#6b7280" }}>Estimated order total</div>
          <div style={{ fontSize: "20px", fontWeight: 600 }}>
            {overallTotal ? usd(overallTotal) : usd(0)}
          </div>
        </div>

        {/* NEW: sketch note when we have any cavities */}
        {cavityMap.size > 0 && (
          <p
            style={{
              marginTop: "8px",
              fontSize: "11px",
              color: "#4b5563",
              lineHeight: 1.5,
            }}
          >
            Dimensions and cavities interpreted from your uploaded sketch.
          </p>
        )}

        <p style={{ marginTop: "24px", fontSize: "12px", color: "#6b7280", lineHeight: 1.5 }}>
          This print view shows the same core specs and estimated pricing as your emailed quote.
          Actual charges may differ if specs or quantities change or if additional services are
          requested.
        </p>
      </div>
    </div>
  );
}
