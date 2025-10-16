// lib/pricing/formula.js
export function priceFromFormula(params, sourceCfg) {
  const { formula, tax, shipping } = sourceCfg || {};
  const {
    baseSetup = 0,
    laborPerUnitMin = 0,
    materialRates = {},
    markup = 1.0,
    discounts = []
  } = formula || {};

  const rate = materialRates[params.material] ?? 0.0025; // fallback
  const materialPerUnit = (params.volumeCubicIn || 0) * rate;
  const laborPerUnit = Math.max(laborPerUnitMin, (params.volumeCubicIn || 0) * 0.00005);

  let unitCost = (materialPerUnit + laborPerUnit) * markup;

  // quantity discounts
  for (const d of discounts) {
    if (params.quantity >= d.minQty) unitCost *= d.multiplier;
  }

  const subtotal = baseSetup + unitCost * params.quantity;

  // naive shipping: weight ~ volume * constant (fake density)
  const estWeightLb = (params.volumeCubicIn || 0) * params.quantity * 0.0004;
  const shippingCost = shipping?.perLb ? estWeightLb * shipping.perLb : 0;

  const taxed = tax?.rate ? subtotal * (1 + tax.rate) : subtotal;
  const total = taxed + shippingCost;

  return {
    unitPrice: round2(unitCost),
    subtotal: round2(subtotal),
    shipping: round2(shippingCost),
    total: round2(total),
    taxRate: tax?.rate || 0,
    currency: "USD",
    notes: []
  };
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
