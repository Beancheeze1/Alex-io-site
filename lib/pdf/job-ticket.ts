// lib/pdf/job-ticket.ts
//
// Step 33: the job ticket as a Letter PDF (pdf-lib, standard fonts). Page 1:
// header, customer / ship-to, foam build, box build, proof, notes, sign-off.
// Then one page per custom RSC / HSC / FOL box line with its flat blank
// drawn to fit (cut = solid, crease = dashed). No prices.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { JobTicket } from "@/app/lib/job-ticket-core";
import { dimsText, ticketDate } from "@/app/lib/job-ticket-core";
import type { Dieline } from "@/lib/box-dieline";
import { formatInches } from "@/lib/corrugated-blank";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 40;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.78, 0.78, 0.8);
const RED = rgb(0.8, 0.1, 0.1);

/** Standard fonts only encode WinAnsi: keep the text plain. */
export function pdfSafe(s: unknown): string {
  return String(s ?? "")
    .replace(/[×]/g, "x")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•·]/g, "-")
    .replace(/→/g, "->")
    .replace(/[\r\t]/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "");
}

type Ctx = { doc: PDFDocument; page: PDFPage; y: number; font: PDFFont; bold: PDFFont };

function newPage(c: Ctx) {
  c.page = c.doc.addPage([PAGE_W, PAGE_H]);
  c.y = PAGE_H - M;
}

function ensure(c: Ctx, h: number) {
  if (c.y - h < M + 20) newPage(c);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function text(c: Ctx, s: string, opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; width?: number } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? c.bold : c.font;
  const x = opts.x ?? M;
  const lines = wrap(s, font, size, opts.width ?? PAGE_W - M - x);
  for (const ln of lines) {
    ensure(c, size + 3);
    c.page.drawText(ln, { x, y: c.y - size, size, font, color: opts.color ?? INK });
    c.y -= size + 3;
  }
}

function heading(c: Ctx, s: string) {
  ensure(c, 30);
  c.y -= 8;
  c.page.drawText(pdfSafe(s).toUpperCase(), { x: M, y: c.y - 10, size: 9, font: c.bold, color: MUTED });
  c.y -= 14;
  c.page.drawLine({ start: { x: M, y: c.y }, end: { x: PAGE_W - M, y: c.y }, thickness: 0.7, color: RULE });
  c.y -= 6;
}

/** label: value pairs, two columns. */
function pairs(c: Ctx, rows: [string, string][]) {
  const colW = (PAGE_W - 2 * M) / 2;
  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2);
    const heights = pair.map(([, v]) => wrap(v || "-", c.font, 10, colW - 90).length);
    const h = Math.max(...heights) * 13;
    ensure(c, h);
    pair.forEach(([k, v], j) => {
      const x = M + j * colW;
      c.page.drawText(pdfSafe(k), { x, y: c.y - 10, size: 8.5, font: c.bold, color: MUTED });
      wrap(v || "-", c.font, 10, colW - 90).forEach((ln, n) => {
        c.page.drawText(ln, { x: x + 88, y: c.y - 10 - n * 13, size: 10, font: c.font, color: INK });
      });
    });
    c.y -= h + 2;
  }
}

/** Simple table: widths in points, header row bold. */
function table(c: Ctx, head: string[], widths: number[], rows: string[][]) {
  const draw = (cells: string[], bold: boolean) => {
    const wrapped = cells.map((v, i) => wrap(v || "", bold ? c.bold : c.font, 9, widths[i] - 6));
    const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 4;
    ensure(c, h);
    let x = M;
    wrapped.forEach((lines, i) => {
      lines.forEach((ln, n) => c.page.drawText(ln, { x: x + 2, y: c.y - 10 - n * 12, size: 9, font: bold ? c.bold : c.font, color: bold ? MUTED : INK }));
      x += widths[i];
    });
    c.y -= h;
    c.page.drawLine({ start: { x: M, y: c.y + 1 }, end: { x: M + widths.reduce((a, b) => a + b, 0), y: c.y + 1 }, thickness: 0.4, color: RULE });
  };
  draw(head, true);
  for (const r of rows) draw(r, false);
  c.y -= 4;
}

const inch = (n: number) => `${formatInches(n)}"`;

function drawDieline(c: Ctx, dl: Dieline, line: number, quoteNo: string) {
  newPage(c);
  text(c, `${quoteNo} - box line ${line}: flat blank`, { size: 14, bold: true });
  text(
    c,
    `${dl.style.toUpperCase()} ${inch(dl.inside.L)} x ${inch(dl.inside.W)} x ${inch(dl.inside.D)} inside, ${dl.flute} flute. Blank ${inch(dl.blank.length_in)} x ${inch(
      dl.blank.width_in,
    )} (lines cover ${inch(dl.drawn.length_in)} x ${inch(dl.drawn.width_in)}).`,
    { size: 10 },
  );
  text(
    c,
    `Panels ${dl.panels_in.map(inch).join(" / ")}; body ${inch(dl.body_in)}; flaps ${inch(dl.flap_in)}; ${
      dl.joint === "taped" ? "taped joint" : `${dl.joint} joint ${inch(dl.joint_in)}`
    }; slots ${inch(dl.slot_in)}. Solid = cut, dashed = crease. Not to scale: use the DXF to cut.`,
    { size: 9, color: MUTED },
  );
  const boxW = PAGE_W - 2 * M;
  const boxH = c.y - M - 20;
  const scale = Math.min(boxW / dl.drawn.length_in, boxH / dl.drawn.width_in);
  const ox = M + (boxW - dl.drawn.length_in * scale) / 2;
  const oy = M + 20 + (boxH - dl.drawn.width_in * scale) / 2;
  const P = (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale });
  for (const s of dl.cut) c.page.drawLine({ start: P(s.x1, s.y1), end: P(s.x2, s.y2), thickness: 0.9, color: INK });
  for (const s of dl.score) c.page.drawLine({ start: P(s.x1, s.y1), end: P(s.x2, s.y2), thickness: 0.7, color: RED, dashArray: [4, 3] });
}

export async function jobTicketPdf(t: JobTicket, opts: { timeZone?: string; dielines?: { line: number; dieline: Dieline }[] } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Job ticket ${t.quote_no}`);
  doc.setCreator("Alex-IO");
  const c: Ctx = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - M,
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const day = (v: string | null) => ticketDate(v, opts.timeZone);

  // header
  c.page.drawText(pdfSafe(t.shop), { x: M, y: c.y - 11, size: 11, font: c.bold, color: MUTED });
  c.page.drawText("JOB TICKET", { x: PAGE_W - M - c.bold.widthOfTextAtSize("JOB TICKET", 11), y: c.y - 11, size: 11, font: c.bold, color: MUTED });
  c.y -= 18;
  text(c, `${t.quote_no}${t.revision ? `  Rev ${t.revision}` : ""}${t.rush ? "   RUSH" : ""}`, { size: 20, bold: true });
  c.y -= 6;
  pairs(c, [
    ["Released", `${day(t.released_at)}${t.released_by ? ` by ${t.released_by}` : ""}`],
    ["Due", "____________________"],
    ["PO", t.po || "-"],
    ["Lead time", t.lead_time || "-"],
    ["Accepted", t.accepted ? `${day(t.accepted.at)}${t.accepted.name ? ` by ${t.accepted.name}` : ""}` : "-"],
    ["Confirmed", t.confirmed ? `${day(t.confirmed.at)}${t.confirmed.by ? ` by ${t.confirmed.by}` : ""}` : "-"],
  ]);

  heading(c, "Customer and shipping");
  const customer = [t.customer.name, t.customer.company, t.customer.email, t.customer.phone].filter(Boolean).join("\n") || "-";
  const shipTo = [t.ship.name, t.ship.company, ...t.ship.lines].filter(Boolean).join("\n") || "-";
  const ship: string[] = [t.ship.terms_label];
  if (t.ship.account) ship.push(`Carrier account ${t.ship.account}`);
  if (t.ship.mode) ship.push(t.ship.mode === "ltl" ? "LTL" : "Parcel");
  if (t.ship.pallets) ship.push(`${t.ship.pallets} pallet${t.ship.pallets > 1 ? "s" : ""}`);
  if (t.ship.cartons) ship.push(`${t.ship.cartons} carton${t.ship.cartons > 1 ? "s" : ""}`);
  if (t.ship.weight_lb) ship.push(`about ${t.ship.weight_lb} lb`);
  pairs(c, [
    ["Customer", customer],
    ["Ship to", shipTo],
    ["Freight", ship.join(", ")],
  ]);

  if (t.foam) {
    const f = t.foam;
    heading(c, `Foam: ${f.sets.toLocaleString("en-US")} set${f.sets === 1 ? "" : "s"}`);
    pairs(c, [
      ["Set size", `${dimsText({ L: f.block.L, W: f.block.W, H: f.block.H })} in`],
      ["Material", f.material || "-"],
    ]);
    table(
      c,
      ["Layer", "Material", "Thick", "Cavities", "Cut file (.dxf / .step)"],
      [70, 150, 50, 55, 207],
      f.layers.map((l) => [
        `${l.n}${l.label ? ` ${l.label}` : ""}${l.loose ? " (loose)" : ""}`,
        l.material || "-",
        inch(l.thickness_in),
        String(l.cavities),
        l.cut_file,
      ]),
    );
    text(c, `Full package: ${f.package_file} (.dxf / .step / .svg) - download from the admin quote page.`, { size: 8.5, color: MUTED });
  }

  if (t.boxes.length) {
    heading(c, `Boxes: ${t.boxes.length} line${t.boxes.length === 1 ? "" : "s"}`);
    table(
      c,
      ["Line", "Qty", "Box", "Inside (L x W x D)", "Board", "Print / run", "Blank"],
      [30, 45, 95, 85, 75, 112, 90],
      t.boxes.map((b) => [
        String(b.line),
        b.qty.toLocaleString("en-US"),
        [b.style_label, b.sku, b.cells ? `${b.cells.across} x ${b.cells.down} cells` : null].filter(Boolean).join(" - "),
        b.inside ? dimsText(b.inside) : "-",
        [b.grade, b.flute && !(b.grade || "").includes(b.flute) ? `${b.flute} flute` : null].filter(Boolean).join(", ") || "-",
        [b.print, b.run].filter(Boolean).join("; "),
        b.blank
          ? `${dimsText({ L: b.blank.length_in, W: b.blank.width_in })}${b.sheet && b.sheet.up > 1 ? ` (${b.sheet.up} up)` : ""}${b.blank_from_die_line ? " (die line)" : ""}`
          : "-",
      ]),
    );
  }

  if (t.proof) {
    heading(c, "Artwork proof");
    const p = t.proof;
    text(
      c,
      p.status === "approved"
        ? `Proof v${p.version} approved${p.approved_by ? ` by ${p.approved_by}` : ""}${p.approved_at ? ` on ${day(p.approved_at)}` : ""}. Print to that version.`
        : p.status === "none"
          ? "Printed job: no proof was sent (released without one)."
          : `Proof v${p.version ?? "?"} is ${p.status === "changes" ? "waiting on changes" : "not approved yet"} (released anyway).`,
      { size: 10, bold: p.status !== "approved" },
    );
  }

  if (t.customer_notes) {
    heading(c, "Customer notes");
    text(c, t.customer_notes, { size: 9.5 });
  }

  heading(c, "Sign-off");
  table(c, ["Step", "By", "Date", "Notes"], [110, 110, 80, 232], [["Cut", "", "", ""], ["Converted / glued", "", "", ""], ["Packed", "", "", ""], ["QC", "", "", ""]]);

  for (const d of opts.dielines ?? []) drawDieline(c, d.dieline, d.line, t.quote_no);

  // page footers
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    const s = pdfSafe(`${t.quote_no} job ticket - page ${i + 1} of ${pages.length}`);
    pg.drawText(s, { x: M, y: 22, size: 8, font: c.font, color: MUTED });
  });
  return doc.save();
}
