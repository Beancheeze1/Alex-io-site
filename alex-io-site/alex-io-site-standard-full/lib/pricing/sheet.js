// lib/pricing/sheet.js
// Reads a Google Sheet range with columns: material,density,ratePerCubicInch,notes
// Requires: GOOGLE_API_KEY, PRICING_SHEET_ID
export async function priceFromSheet(params, sourceCfg) {
  const { apiKey, sheetId, range } = sourceCfg || {};
  if (!apiKey || !sheetId || !range) {
    throw new Error("Missing Google Sheets config (apiKey, sheetId, range)");
  }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status}`);
  const json = await res.json();

  const rows = json.values || [];
  const header = rows[0] || [];
  const idx = {
    material: header.indexOf("material"),
    rate: header.indexOf("ratePerCubicInch")
  };
  let rate = 0.0025; // fallback

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const mat = (r[idx.material] || "").toLowerCase().trim();
    if (mat === params.material) {
      rate = Number(r[idx.rate] || 0.0025);
      break;
    }
  }

  const unitPrice = (params.volumeCubicIn || 0) * rate * 1.15; // markup 15%
  const subtotal = unitPrice * params.quantity;
  return {
    unitPrice: round2(unitPrice),
    subtotal: round2(subtotal),
    shipping: 0,
    total: round2(subtotal),
    taxRate: 0,
    currency: "USD",
    notes: ["Priced via Google Sheet"]
  };
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
