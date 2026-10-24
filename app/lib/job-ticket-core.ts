// app/lib/job-ticket-core.ts
//
// Step 33: the shop-floor job ticket for a released quote (types and pure
// helpers, safe in the browser). Built by app/lib/job-ticket.ts, shown at
// /admin/quotes/[quote_no]/ticket and as a PDF (lib/pdf/job-ticket.ts).
// No prices: the ticket is the floor copy.
// Step 39N: on the ticket a stack entry is a "part" and each laminated sheet a
// "layer" (app/lib/foam-terms.ts); the type and field names keep the old words.

import type { FreightTerms } from "@/app/lib/freight-core";
import type { FoamGeometry } from "@/app/lib/pricing/foam-geometry";
import { sanitizeFilenamePart } from "@/app/lib/cad-download";
import { partName } from "@/app/lib/foam-terms";

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
  build?: TicketFoamBuild | null; // Step 39M: how each piece is laminated from stock sheets
};

/** Step 39M: one sheet of a finished part, as the floor cuts and glues it. */
export type TicketFoamSheet = {
  layer: number; // 1-based layer (bottom of the stack first)
  n: number; // 1-based sheet in its layer, from the cavity face
  from_in: number; // where it sits, measured from the cavity face
  thickness_in: number; // finished (after skiving)
  stock_in: number | null; // stock sheet it's cut from (null = no stock sizes set)
  skived: boolean;
  cavities: number; // cavities cut through it
  file: number; // sheet cut file (TicketSheetFile.file)
};

/** Step 39M: one sheet cut file = one steel-rule die / CNC program. */
export type TicketSheetFile = {
  file: number; // 1-based
  name: string; // DXF base name (no extension)
  per_part: number; // sheets cut with it per finished part
  cavities: number; // cavities cut through
  used_in: string; // "Part 1 layers 3-4, Part 2 layer 1"
  layer_index: number; // 0-based layer the DXF is drawn from
  cavity_index: number[]; // that layer's cavities drawn in it
};

export type TicketFoamBuild = {
  stock_in: number[]; // stock sheet thicknesses used (empty = none set)
  sheets_per_part: number;
  glue_lines: number; // per finished part
  sheets: TicketFoamSheet[];
  files: TicketSheetFile[];
  steps: string[]; // laminate / glue / pack loose, layer by layer
  note: string | null;
};

/** "3-4" or "3" (sheet numbers in one layer). */
function runList(ns: number[]): string {
  const s = [...ns].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? String(s[i]) : `${s[i]}-${s[j]}`);
    i = j;
  }
  return out.join(", ");
}

/**
 * Step 39M: the ticket's sheet build from a geometry that has its sheets
 * (withSheets in app/lib/pricing/foam-geometry.ts). Sheets that are cut the
 * same (same outline, same cavities through) share one cut file.
 */
export function foamBuildForTicket(args: {
  geom: FoamGeometry;
  labels: (string | null)[]; // layer names, same order as geom.layers
  quoteNo: string;
  revision: string | null;
  note?: string | null;
}): TicketFoamBuild | null {
  const sheets = args.geom.sheets;
  if (!sheets || sheets.length === 0) return null;
  const fileOf = new Map<string, number>();
  const files: TicketSheetFile[] = [];
  const q = sanitizeFilenamePart(args.quoteNo || "quote");
  const rev = sanitizeFilenamePart(args.revision || "");
  for (const s of sheets) {
    if (fileOf.has(s.pattern)) continue;
    const file = files.length + 1;
    fileOf.set(s.pattern, file);
    const cav = s.cavity_index.length;
    files.push({
      file,
      name: [q, rev, `Cut-${file}`, cav ? `${cav}-cavit${cav === 1 ? "y" : "ies"}` : "solid"].filter(Boolean).join("__"),
      per_part: 0,
      cavities: cav,
      used_in: "",
      layer_index: s.layer - 1,
      cavity_index: [...s.cavity_index],
    });
  }
  // Step 39M2 / 39N: "Part 2 Top Pad", or "Part 1" when it only has the default name
  const layerName = (n: number) => partName(args.labels[n - 1], n - 1);
  for (const f of files) {
    const mine = sheets.filter((s) => fileOf.get(s.pattern) === f.file);
    f.per_part = mine.length;
    const layers = Array.from(new Set(mine.map((s) => s.layer))).sort((a, b) => a - b);
    f.used_in = layers
      .map((ly) => {
        const ns = mine.filter((s) => s.layer === ly).map((s) => s.n);
        return `Part ${ly} layer${ns.length > 1 ? "s" : ""} ${runList(ns)}`;
      })
      .join(", ");
  }

  const steps: string[] = [];
  args.geom.layers.forEach((ly, i) => {
    const n = i + 1;
    const k = sheets.filter((s) => s.layer === n).length;
    if (k > 1) steps.push(`${layerName(n)}: laminate layers 1-${k} (${k - 1} glue line${k - 1 === 1 ? "" : "s"}), layer 1 on the cavity face.`);
    else if (k === 1) steps.push(`${layerName(n)}: one layer, no lamination.`);
    const next = args.geom.layers[i + 1];
    if (next) {
      if (!ly.loose && !next.loose) steps.push(`Glue part ${n} to part ${n + 1} (1 glue line).`);
    }
    if (ly.loose && args.geom.layers.length > 1) steps.push(`${layerName(n)}: separate part, pack loose (not glued).`);
  });

  return {
    stock_in: args.geom.stock_in ?? [],
    sheets_per_part: sheets.length,
    glue_lines: args.geom.glue_lines,
    sheets: sheets.map((s) => ({
      layer: s.layer,
      n: s.n,
      from_in: s.from_in,
      thickness_in: s.thickness_in,
      stock_in: s.stock_in,
      skived: s.skived,
      cavities: s.cavity_index.length,
      file: fileOf.get(s.pattern) ?? 0,
    })),
    files,
    steps,
    note: args.note ?? null,
  };
}

/** Step 39M: the layout with one layer cut down to the cavities a sheet file has (its DXF). */
export function sheetLayout(layout: unknown, file: Pick<TicketSheetFile, "layer_index" | "cavity_index">): Record<string, unknown> | null {
  if (!layout || typeof layout !== "object") return null;
  const lay = layout as Record<string, unknown>;
  const block = (lay.block && typeof lay.block === "object" ? lay.block : {}) as Record<string, unknown>;
  const stack: Record<string, unknown>[] =
    Array.isArray(lay.stack) && lay.stack.length > 0
      ? (lay.stack as Record<string, unknown>[])
      : [{ thicknessIn: block.thicknessIn, cavities: Array.isArray(lay.cavities) ? lay.cavities : [] }];
  const keep = new Set(file.cavity_index);
  return {
    ...lay,
    stack: stack.map((ly, i) =>
      i === file.layer_index
        ? { ...ly, cavities: (Array.isArray(ly.cavities) ? (ly.cavities as unknown[]) : []).filter((_, k) => keep.has(k)) }
        : ly,
    ),
  };
}

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
  blank: { length_in: number; width_in: number } | null; // as priced (or from the die line, below)
  blank_from_die_line?: boolean; // Step 36C: no priced blank, so it comes from the RSC / HSC / FOL die line
  sheet: { length_in: number; width_in: number; up: number } | null; // as priced (sheet board)
  dxf: boolean; // a flat blank DXF can be made (custom RSC / HSC / FOL)
  // Step 39Q: a part priced from the customer's die line file: its own cut file
  // (just this part's lines, from the file kept on the quote) and the file it came from.
  part_file?: { name: string; source: string | null; piece: number | null } | null;
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
