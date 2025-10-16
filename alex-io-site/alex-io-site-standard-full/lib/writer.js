// lib/writer.js
export function compose(template, data, cfg) {
  const sig = cfg?.brand?.signature || "\n— Alex-IO Bot";
  if (template === "quote_reply") {
    const lines = [];
    lines.push(`Thanks for your request! Here’s a quick estimate:`);
    lines.push(`• Quantity: ${data.params.quantity}`);
    lines.push(`• Size (L×W×H): ${fmt(data.params.lengthIn)}" × ${fmt(data.params.widthIn)}" × ${fmt(data.params.heightIn)}"`);
    lines.push(`• Material: ${data.params.material}`);
    lines.push(`• Unit price: $${data.result.unitPrice}`);
    lines.push(`• Subtotal: $${data.result.subtotal}`);
    if (data.result.shipping) lines.push(`• Shipping: $${data.result.shipping}`);
    if (data.result.taxRate)  lines.push(`• Tax: ${(data.result.taxRate*100).toFixed(1)}%`);
    lines.push(`• Total: $${data.result.total}`);
    lines.push("");
    lines.push(`Lead time: 5 business days (subject to confirmation).`);
    lines.push(`If you share your ship-to ZIP and any special requirements, we’ll finalize and lock pricing.`);
    lines.push(sig);
    return lines.join("\n");
  }

  if (template === "error_reply") {
    return `Thanks for the details! I need a bit more info to quote accurately:\n${data.errors.map(e => "• " + e).join("\n")}\n\nCould you reply with those?${sig}`;
  }

  return `Thanks for reaching out! We'll get back to you shortly.${sig}`;
}

function fmt(n){ return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }
