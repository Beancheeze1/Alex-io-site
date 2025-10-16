// lib/quote-pdf-lib.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function renderQuotePdf({ quote, title = "Quote", company = "Your Company", footer = "Thank you." }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 792 - 36;
  const draw = (t, x, size=12, font=fontRegular, color=rgb(0,0,0)) =>
    page.drawText(String(t ?? ""), { x, y, size, font, color });

  draw(`${company} - ${title}`, 36, 18, fontBold);
  y -= 22; draw(new Date().toLocaleString(), 36, 10, fontRegular, rgb(0.4,0.4,0.4));
  y -= 18; draw("Line Items", 36, 12, fontBold); y -= 16;

  const col = { sku:36, name:186, qty:396, unit:456, line:516 };
  draw("SKU",col.sku,12,fontBold); draw("Name",col.name,12,fontBold);
  draw("Qty",col.qty,12,fontBold); draw("Unit",col.unit,12,fontBold); draw("Line",col.line,12,fontBold); y -= 16;

  const lines = Array.isArray(quote?.lines) ? quote.lines : [];
  for (const L of lines) {
    draw(L.sku, col.sku); draw(L.name, col.name); draw(String(L.qty), col.qty);
    draw(`$${Number(L.unitPrice).toFixed(2)}`, col.unit);
    draw(`$${Number(L.lineSubtotal).toFixed(2)}`, col.line);
    y -= 16;
  }

  y -= 8;
  draw(`Subtotal: $${Number(quote?.subtotal ?? 0).toFixed(2)}`, 36); y -= 16;
  if (quote?.orderSurcharge?.amount) { draw(`Surcharges: $${Number(quote.orderSurcharge.amount).toFixed(2)}`, 36); y -= 16; }
  draw(`Tax (${quote?.taxPct ?? 0}%): $${Number(quote?.taxAmt ?? 0).toFixed(2)}`, 36); y -= 18;
  draw(`TOTAL: $${Number(quote?.total ?? 0).toFixed(2)}`, 36, 14, fontBold); y -= 24;
  draw(footer, 36, 10, fontRegular, rgb(0.4,0.4,0.4));

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
