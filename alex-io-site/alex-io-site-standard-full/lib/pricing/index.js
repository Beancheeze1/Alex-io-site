// lib/pricing/index.js
import { priceFromFormula } from "./formula.js";
import { priceFromSheet } from "./sheet.js";
import { priceFromPg } from "./pg.js";

export async function calcPrice(params, sourceCfg) {
  const kind = sourceCfg?.kind || "formula";
  if (kind === "sheet")    return priceFromSheet(params, sourceCfg);
  if (kind === "postgres") return priceFromPg(params, sourceCfg);
  return priceFromFormula(params, sourceCfg);
}
