// lib/pricing/pg.js
import { Client } from "pg";

export async function priceFromPg(params, sourceCfg) {
  const client = new Client({ connectionString: sourceCfg?.url });
  await client.connect();
  try {
    // Expect a table with material rates; adjust to your schema
    // schema: material_rates(material TEXT PRIMARY KEY, rate_per_cuin NUMERIC, markup NUMERIC)
    const { rows } = await client.query(
      `SELECT rate_per_cuin AS rate, COALESCE(markup, 1.15) AS markup
         FROM material_rates
        WHERE material = $1`,
      [params.material]
    );
    const rate = rows[0]?.rate ?? 0.0025;
    const markup = rows[0]?.markup ?? 1.15;

    const unitPrice = (params.volumeCubicIn || 0) * rate * markup;
    const subtotal = unitPrice * params.quantity;

    return {
      unitPrice: round2(unitPrice),
      subtotal: round2(subtotal),
      shipping: 0,
      total: round2(subtotal),
      taxRate: 0,
      currency: "USD",
      notes: ["Priced via Postgres"]
    };
  } finally {
    await client.end();
  }
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
