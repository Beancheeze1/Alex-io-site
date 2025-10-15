// lib/quotePdf.js
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

function getFontPath() {
  // Prefer a repo font
  const repoFont = path.join(process.cwd(), "public", "fonts", "Inter-Regular.ttf");
  if (fs.existsSync(repoFont)) return repoFont;

  // Fallback to Arial on Windows if you did not add a repo font yet
  const winArial = "C:\\Windows\\Fonts\\arial.ttf";
  if (process.platform === "win32" && fs.existsSync(winArial)) return winArial;

  throw new Error("No TTF font found. Add public/fonts/Inter-Regular.ttf or copy a TTF into that folder.");
}

export function renderQuotePdf({
  quote,
  title = "Quote",
  company = "Your Company",
  footer = "Thank you."
}) {
  const doc = new PDFDocument({ size: "LETTER", margin: 36 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Use a true type font so PDFKit does not try to read AFM files
  const fontPath = getFontPath();
  doc.registerFont("Body", fontPath);
  doc.font("Body");

  // Header
  doc.fontSize(18).text(`${company} - ${title}`);
  doc.moveDown(0.5).fontSize(10).fillColor("#666").text(new Date().toLocaleString());
  doc.moveDown();

  // Table header
  doc.fillColor("#000").fontSize(12).text("Line Items", { underline: true }).moveDown(0.3);
  const col = (t, w) => doc.text(t, { width: w, continued: true });

  doc.fontSize(12);
  col("SKU", 150); col("Name", 200); col("Qty", 60); col("Unit", 60); col("Line", 70);
  doc.text("");

  // Rows
  for (const L of quote.lines || []) {
    col(L.sku, 150);
    col(L.name, 200);
    col(String(L.qty), 60);
    col(`$${Number(L.unitPrice).toFixed(2)}`, 60);
    col(`$${Number(L.lineSubtotal).toFixed(2)}`, 70);
    doc.text("");
  }

  // Totals
  doc.moveDown();
  const os = quote.orderSurcharge || { percent: 0, flat: 0, amount: 0 };
  doc.text(`Subtotal: $${Number(quote.subtotal).toFixed(2)}`);
  if (os.percent || os.flat || os.amount) {
    doc.text(`Surcharges: $${Number(os.amount).toFixed(2)} (pct ${os.percent || 0}, flat ${os.flat || 0})`);
  }
  doc.text(`Tax (${quote.taxPct || 0}%): $${Number(quote.taxAmt).toFixed(2)}`);
  doc.moveDown(0.2).fontSize(14).text(`TOTAL: $${Number(quote.total).toFixed(2)}`);

  // Footer
  doc.moveDown().fontSize(10).fillColor("#666").text(footer);

  doc.end();
  return done; // Promise<Buffer>
}
