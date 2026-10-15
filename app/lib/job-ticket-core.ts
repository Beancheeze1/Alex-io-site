// app/lib/job-ticket-core.ts
//
// Step 33: the shop-floor job ticket for a released quote (types and pure
// helpers, safe in the browser). Built by app/lib/job-ticket.ts, shown at
// /admin/quotes/[quote_no]/ticket and as a PDF (lib/pdf/job-ticket.ts).
// No prices: the ticket is the floor copy.

import type { FreightTerms } from "@/app/lib/freight-core";

export type TicketFoamLayer = {
  n: number; // 1-based, bottom of the stack first (as the editor lists them)
  label: string | null;
  thickness_in: number;
  material: string | null;
  cavities: number;
  loose: boolean;
  cut_file: string; // per-layer DXF / STEP base name (no extension)
};

export type TicketFoam = {
  sets: number; // quantity of complete foam sets
  material: string | null; // primary material
  block: { L: number; W: number; H: number };
  layers: TicketFoamLayer[];
  package_file: string; // full-package DXF / STEP base name (no extension)
  release_pkg_id: number | null;
};

export type TicketBox = {
  line: number; // 1-based, in the order the quote lists them
  id: number;
  kind: "stock" | "custom";
  qty: number;
  style: string; // rsc / hsc / fol / mailer / tray / pad / partition, or the stock box's style
  style_label: string;
  sku: string | null;
  vendor: string | null;
  description: string | null;
  inside: { L: number; W: number; D: number } | null;
  grade: string | null;
  flute: string | null;
  cells: { across: number; down: number } | null;
  print: string; // "No print", "2-color print (1 spot, 1 flood), one side", "Digital print, one side"
  run: string | null; // "Press (plates)" / "Short run (digital + CAD cut)" / null for stock
  blank: { length_in: number; width_in: number } | null; // as priced
  sheet: { length_in: number; width_in: number; up: number } | null; // as priced (sheet board)
  dxf: boolean; // a flat blank DXF can be made (custom RSC / HSC / FOL)
};

export type JobTicket = {
  shop: string;
  quote_no: string;
  revision: string | null;
  created_at: string | null;
  released_at: string | null;
  released_by: string | null;
  customer: { name: string | null; company: string | null; email: string | null; phone: string | null };
  po: string | null;
  rush: boolean;
  accepted: { name: string | null; at: string } | null;
  confirmed: { by: string | null; at: string } | null;
  lead_time: string | null;
  ship: {
    terms: FreightTerms;
    terms_label: string;
    name: string | null;
    company: string | null;
    lines: string[]; // address lines, ready to print
    account: string | null;
    mode: "parcel" | "ltl" | null;
    cartons: number | null;
    pallets: number | null;
    weight_lb: number | null;
  };
  foam: TicketFoam | null;
  boxes: TicketBox[];
  proof: { required: boolean; version: number | null; status: string; approved_by: string | null; approved_at: string | null } | null;
  customer_notes: string | null;
};

export const TERMS_SHORT: Record<FreightTerms, string> = {
  prepaid_add: "Prepaid & add",
  fob_origin: "FOB origin (collect)",
  pickup: "Customer pickup",
};

/** "12 x 10 x 8" with up to 4 decimals, no trailing zeros. */
export function dimsText(d: { L: number; W: number; D?: number; H?: number } | null): string {
  if (!d) return "";
  const n = (v: number) => String(Number(Number(v).toFixed(4)));
  const third = d.D ?? d.H;
  return third == null ? `${n(d.L)} x ${n(d.W)}` : `${n(d.L)} x ${n(d.W)} x ${n(third)}`;
}

/** City, ST ZIP from the parts that are there. */
export function addressLines(a: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string[] {
  const out: string[] = [];
  if (a.line1) out.push(a.line1);
  if (a.line2) out.push(a.line2);
  const cityState = [a.city, a.state].filter(Boolean).join(", ");
  const last = [cityState, a.zip].filter(Boolean).join(" ");
  if (last) out.push(last);
  return out;
}

export function runText(method: unknown): string | null {
  if (method === "digital") return "Short run (digital print + CAD cut)";
  if (method === "plates") return "Press (plates)";
  return null;
}

/** "Oct 15, 2026" in the shop's view (UTC date when no time zone is given). */
export function ticketDate(iso: string | null, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timeZone || "UTC" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
