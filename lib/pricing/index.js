// lib/pricing/index.js
import { priceFromSheet } from "./sheet.js";
import { priceFromPg } from "./pg.js";
import { priceFromFormula } from "./formula.js";

export async function calcPrice(params, cfg) {
  const src = cfg.pricingSource?.kind;
  if (src === "sheet")   return priceFromSheet(params, cfg.pricingSource);
  if (src === "postgres")return priceFromPg(params, cfg.pricingSource);
  return priceFromFormula(params, cfg.pricingSource); // safe default
}
