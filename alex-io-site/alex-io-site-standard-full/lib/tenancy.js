// lib/tenancy.js
export const tenants = {
  default: {
    brand: { signature: "\n— Alex-IO Bot" },

    // Pick ONE pricingSource per tenant:
    // 1) Formula-only
    pricingSource: {
      kind: "formula",
      formula: {
        // example rates — tweak for your business
        baseSetup: 25,                // flat setup fee per quote
        laborPerUnitMin: 0.25,        // minimum labor per unit
        materialRates: {              // $ per cubic inch by material
          foam_1_7lb: 0.0024,
          foam_2_2lb: 0.0028,
          crate_plywood: 0.0010
        },
        markup: 1.15,                 // 15% markup
        discounts: [                  // simple breakpoints
          { minQty: 100, multiplier: 0.97 },
          { minQty: 250, multiplier: 0.95 },
          { minQty: 500, multiplier: 0.92 }
        ]
      },
      tax: { rate: 0.00 },            // 0% by default; set per region
      shipping: { perLb: 0.75 }       // simple shipping model (optional)
    },

    // 2) Or Google Sheet (uncomment to use)
    // pricingSource: {
    //   kind: "sheet",
    //   sheetId: process.env.PRICING_SHEET_ID, // Google Sheet ID
    //   apiKey: process.env.GOOGLE_API_KEY,    // API key with Sheets read access
    //   range: "Rates!A:D" // columns: material,density,ratePerCubicInch,notes
    // },

    // 3) Or Postgres (uncomment to use)
    // pricingSource: {
    //   kind: "postgres",
    //   url: process.env.DATABASE_URL,  // e.g., postgres://user:pass@host:5432/db
    //   schema: "public",               // optional
    // },

    features: { quotes: true, meetings: true, infoLookup: true }
  }
};

// simple resolver (single tenant: always returns default)
export function resolveTenant() {
  return { tenantId: "default", cfg: tenants.default };
}
