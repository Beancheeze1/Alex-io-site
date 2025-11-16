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
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  material_name: string | null;
};

type CavityRow = {
  quote_item_id: number;
  label: string;
  count: number;
  cav_length_in: string;
  cav_width_in: string;
  cav_depth_in: string;
};

function usd(value: number | null | undefined): string {
  const n =
    typeof value === "number" && isFinite(value)
      ? value
      : 0;
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
    `,
    [quoteNo]
  );

  if (!quote) {
    return (
      <div style={{ padding: "40px", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>Quote not found</h1>
        <p style={{ color: "#555" }}>We couldn&apos;t find a quote with number <code>{quoteNo}</code>.</p>
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
      order by quote_item_id, id
      `,
      [itemIds]
    );

    for (const c of cavities) {
      const list = cavityMap.get(c.quote_item_id) ?? [];
      list.push(c);
      cavityMap.set(c.quote_item_id, list);
    }
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const priced = await Promise.all(
    items.map(async (item) => {
      const cavities = cavityMap.get(item.id) ?? [];
      const cavStrings = cavities.map(
        (c) => `${c.cav_length_in}x${c.cav_width_in}x${c.cav_depth_in}`
      );

      let calc: any = null;
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
        // swallow; we still show non-priced view
      }

      return { item, cavities, calc };
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
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px" }}>Quote #{quote.quote_no}</h1>
            <p style={{ margin: "4px 0 0 0", color: "#4b5563" }}>
              {quote.customer_name}
              {quote.email ? <> &middot; {quote.email}</> : null}
              {quote.phone ? <> &middot; {quote.phone}</> : null}
            </p>
            <p style={{ margin: "4px 0 0 0", color: "#6b7280", fontSize: "12px" }}>
              Created: {new Date(quote.created_at).toLocaleString()}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: "12px", color: "#6b7280" }}>
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
                Use your browser&apos;s <strong>Print</strong> command to print this page.
              </span>
            </div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />

        <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>Line items</h2>
        {priced.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No line items stored for this quote yet.</p>
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
                <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #e5e7eb" }}>
                  Item
                </th>
                <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #e5e7eb" }}>
                  Dimensions (L × W × H)
                </th>
                <th style={{ textAlign: "right", padding: "8px", borderBottom: "1px solid #e5e7eb" }}>
                  Qty
                </th>
                <th style={{ textAlign: "right", padding: "8px", borderBottom: "1px solid #e5e7eb" }}>
                  Est. total
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
                return (
                  <tr key={item.id}>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ fontWeight: 500 }}>Line {idx + 1}</div>
                      <div style={{ color: "#6b7280" }}>{label}</div>
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
                        whiteSpace: "nowrap",
                      }}
                    >
                      {total != null ? usd(Number(total)) : <span style={{ color: "#9ca3af" }}>N/A</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Estimated total</div>
            <div style={{ fontSize: "20px", fontWeight: 600 }}>
              {overallTotal ? usd(overallTotal) : usd(0)}
            </div>
          </div>
        </div>

        <p style={{ marginTop: "24px", fontSize: "12px", color: "#6b7280", lineHeight: 1.5 }}>
          This print view shows the same core specs and estimated pricing as your emailed quote.
          Actual charges may differ if specs or quantities change or if additional services are requested.
        </p>
      </div>
    </div>
  );
}
