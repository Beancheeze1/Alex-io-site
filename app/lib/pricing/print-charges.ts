// app/lib/pricing/print-charges.ts
//
// One place that decides a quote's printing charges for display and email
// (/api/quote/print, /api/admin/send-quote).
//
//   per_color (Corrugated Step 3B) — the quote has facts.print_spec. Print
//     run + setup are already inside each box's price; the only separate
//     charge is plates (sum of quote_box_selections.plates_usd).
//     printingUpcharge = plates total, so existing totals still add up.
//   legacy — no print_spec: flat art-setup fee + % of (foam + packaging) when
//     facts.printed is set, exactly as before.

import { describePrintSpec, parsePrintSpec } from "@/lib/corrugated-price";

export type PrintCharges = {
  printModel: "per_color" | "legacy";
  isPrinted: boolean;
  artSetupFee: number;
  printingUpchargePct: number;
  printingUpchargeAmt: number;
  printingUpcharge: number;
  platesTotal: number;
  printSummary: string | null;
};

export function computePrintCharges(args: {
  facts: any;
  settings: { printing_upcharge_usd?: unknown; printing_upcharge_pct?: unknown };
  foamSubtotal: number;
  packagingSubtotal: number;
  platesTotal: number;
}): PrintCharges {
  const spec = parsePrintSpec(args.facts?.print_spec);
  if (spec) {
    const plates = Math.round((Number(args.platesTotal) || 0) * 100) / 100;
    return {
      printModel: "per_color",
      isPrinted: spec.colors.length > 0,
      artSetupFee: 0,
      printingUpchargePct: 0,
      printingUpchargeAmt: 0,
      printingUpcharge: plates,
      platesTotal: plates,
      printSummary: spec.colors.length > 0 ? describePrintSpec(spec) : null,
    };
  }

  const f = args.facts || {};
  const isPrinted = !!(f.printed === 1 || f.printed === "1" || f.printed === true);
  const artSetupFee = isPrinted ? Number(args.settings.printing_upcharge_usd || 0) : 0;
  const printingUpchargePct = isPrinted ? Number(args.settings.printing_upcharge_pct || 0) : 0;
  const basis = (Number(args.foamSubtotal) || 0) + (Number(args.packagingSubtotal) || 0);
  const printingUpchargeAmt = Math.round(basis * (printingUpchargePct / 100) * 100) / 100;
  return {
    printModel: "legacy",
    isPrinted,
    artSetupFee,
    printingUpchargePct,
    printingUpchargeAmt,
    printingUpcharge: artSetupFee + printingUpchargeAmt,
    platesTotal: 0,
    printSummary: null,
  };
}
