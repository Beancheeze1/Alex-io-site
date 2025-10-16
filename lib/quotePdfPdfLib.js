// lib/quotePdfPdfLib.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function renderQuotePdf({
  quote,
  title = "Quote",
  company = "Your Company",
  footer = "Thank you."
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const { width } = page.getSize();

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold    = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 36;
  let y = 792 - margin;

  const drawText = (text, x, size = 12, font = fontRegular, color = rgb(0,0,0)) => {
    page.drawText(String(text ?? ""), { x, y, size, font, color });
  };

  // Header
  drawText(`${company} - ${title}`, margin, 18, fontBold);
  y -= 22;
  drawText(new Date().toLocaleString(), margin, 10, fontRegular, rgb(0.4,0.4,0.4));
  y -= 18;

  // Section title
  drawText("Line Items", margin, 12, fontBold);
  y -= 16;

  // Table header
  const colX = { sku: margin, name: margin + 150, qty: margin + 360, unit: margin + 420, line: margin + 480 };
  drawText("SKU",  colX.sku, 12, fontBold);
  drawText("Name", colX.name, 12, fontBold);
  drawText("Qty",  colX.qty,  12, fontBold);
  drawText("Unit", colX.unit, 12, fontBold);
  drawText("Line", colX.line, 12, fontBold);
  y -= 16;

  // Rows
  const lines = Array.isArray(quote?.lines) ? quote.lines : [];
  for (const L of lines) {
    drawText(L.sku ?? "",               colX.sku);
    drawText(L.name ?? "",              colX.name);
    drawText(String(L.qty ?? 0),        colX.qty);
    drawText(`$${Number(L.unitPrice ?? 0).toFixed(2)}`, colX.unit);
    drawText(`$${Number(L.lineSubtotal ?? 0).toFixed(2)}`, colX.line);
    y -= 16;
    if (y < margin + 120) {
      y = 792 - margin;
      pdf.addPage([612, 792]);
    }
  }

  // Totals
  y -= 8;
  const os = quote?.orderSurcharge ?? { percent: 0, flat: 0, amount: 0 };
  drawText(`Subtotal: $${Number(quote?.subtotal ?? 0).toFixed(2)}`, margin);
  y -= 16;
  if (os.percent || os.flat || os.amount) {
    drawText(`Surcharges: $${Number(os.amount).toFixed(2)} (pct ${os.percent || 0}, flat ${os.flat || 0})`, margin);
    y -= 16;
  }
  drawText(`Tax (${quote?.taxPct || 0}%): $${Number(quote?.taxAmt ?? 0).toFixed(2)}`, margin);
  y -= 18;
  drawText(`TOTAL: $${Number(quote?.total ?? 0).toFixed(2)}`, margin, 14, fontBold);
  y -= 24;

  // Footer
  drawText(footer, margin, 10, fontRegular, rgb(0.4,0.4,0.4));

  const bytes = await pdf.save(); // Uint8Array
  return Buffer.from(bytes);      // Node Buffer (for upload)
}
