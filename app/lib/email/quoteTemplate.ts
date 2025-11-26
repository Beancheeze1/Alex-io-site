// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Input shape (from orchestrator):
//
// templateInput = {
//   customerLine: string,
//   quoteNumber: string | null,
//   status: string,
//   specs: {
//     L_in: number;
//     W_in: number;
//     H_in: number;
//     qty: number | string | null;
//     density_pcf: number | null;
//     foam_family: string | null;
//     thickness_under_in?: number | null;
//     color?: string | null;
//     cavityCount?: number | null;
//     cavityDims?: string[];          // e.g. ["1x1x1", "2x2x1"]
//   },
//   material: {
//     name?: string | null;
//     density_lbft3?: number | null;
//     kerf_pct?: number | null;
//     min_charge?: number | null;
//   },
//   pricing: {
//     total: number;
//     piece_ci?: number | null;
//     order_ci?: number | null;
//     order_ci_with_waste?: number | null;
//     used_min_charge?: boolean | null;
//     raw?: any;
//     price_breaks?: {
//       qty: number;
//       total: number;
//       piece: number | null;
//       used_min_charge?: boolean | null;
//     }[];
//   },
//   missing: string[];                // e.g. ["Cavity sizes"]
//   facts: Record<string, any>;       // raw facts (for layout URL, etc.)
// };

export type PriceBreak = {
  qty: number;
  piece: number | null;
  total: number;
  used_min_charge?: boolean | null;
};

export type TemplateSpecs = {
  L_in: number;
  W_in: number;
  H_in: number;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family: string | null;
  thickness_under_in?: number | null;
  color?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[];
};

export type TemplateMaterial = {
  name?: string | null;
  density_lbft3?: number | null;
  kerf_pct?: number | null;
  min_charge?: number | null;
};

export type TemplatePricing = {
  total: number;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean | null;
  raw?: any;
  price_breaks?: PriceBreak[] | null;
};

export type TemplateInput = {
  customerLine?: string;
  quoteNumber: string | null;
  status: string;
  specs: TemplateSpecs;
  material: TemplateMaterial;
  pricing: TemplatePricing;
  missing?: string[] | null;
  facts?: Record<string, any>;
};

function fmtInchesTriple(
  L: number | null | undefined,
  W: number | null | undefined,
  H: number | null | undefined,
): string {
  if (L == null || W == null || H == null) return "—";
  return `${fmtNumber(L, 2)} × ${fmtNumber(W, 2)} × ${fmtNumber(H, 2)} in`;
}

function fmtNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value == null || !isFinite(value)) return "—";
  return value.toFixed(decimals).replace(/\.00$/, "");
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  return "$" + value.toFixed(2);
}

function fmtPercent(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  return value.toFixed(1).replace(/\.0$/, "") + "%";
}

function fmtQty(q: number | string | null | undefined): string {
  if (q == null || q === "") return "—";
  return String(q);
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build human-readable cavity label like:
// "1 cavity — 1x1x1" or "3 cavities — 1x1x1, 2x2x1"
function buildCavityLabel(specs: TemplateSpecs): string {
  const count = specs.cavityCount ?? (specs.cavityDims?.length || 0);
  const dims = (specs.cavityDims || []).filter((s) => !!s && typeof s === "string");

  if (!count && dims.length === 0) return "—";

  const countLabel =
    count === 1
      ? "1 cavity"
      : `${count} cavities`;

  const dimsLabel = dims.length
    ? " — " + dims.join(", ")
    : "";

  return countLabel + dimsLabel;
}

// Build the layout editor URL based on facts/specs.
function buildLayoutUrl(input: TemplateInput): string | null {
  const { quoteNumber, specs, facts } = input;
  if (!quoteNumber) return null;

  const base =
    (process.env.NEXT_PUBLIC_BASE_URL as string | undefined) ||
    "https://api.alex-io.com"
