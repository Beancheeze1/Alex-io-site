// lib/skills/quote.js
import { extractQuoteParams, validateQuoteParams } from "../parsers/quoteParams.js";
import { calcPrice } from "../pricing/index.js";
import { compose } from "../writer.js";

export async function handleQuote({ text, cfg }) {
  const params = extractQuoteParams(text);
  const errors = validateQuoteParams(params);
  if (errors.length) {
    return compose("error_reply", { errors }, cfg);
  }

  const result = await calcPrice(params, cfg.pricingSource);
  return compose("quote_reply", { params, result }, cfg);
}
