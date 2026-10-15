// app/lib/pricing/compute.ts
//
// computePricing — DB-backed foam pricing for server code that can't (or
// shouldn't) make an HTTP call to /api/quotes/calc (send-quote).
//
// Step 22:
//   - The math is the shared formula in app/lib/pricing/foam-core.ts, so this
//     and /api/quotes/calc can never disagree.
//   - tenant_id is required: the shop's settings and material prices are
//     always the quote's shop's (no silent "default").
//   - The old computePricingBreakdown() (its own settings + a different
//     formula, never called) is gone.

import { one } from "@/lib/db";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { applyShopPrice, resolveTenantNumericId, shopMaterialPrice } from "@/lib/material-prices";
import { priceFoam, type FoamMaterial, type FoamPrice } from "@/app/lib/pricing/foam-core";

export type CalcResult = FoamPrice & { [key: string]: any };

type MaterialRow = FoamMaterial & { id: number; thickness_in: number | null };

export async function computePricing(params: {
  L: number;
  W: number;
  H: number;
  qty: number;
  material_id: number;
  cavities?: string[];
  cavity_ci?: number | null; // Step 23: cavity volume per piece from the layout
  force_skived?: boolean;
  round_to_bf?: boolean;
  tenant_id: number | string;
}): Promise<CalcResult> {
  const tenantId = await resolveTenantNumericId(params.tenant_id);
  if (tenantId == null) throw new Error(`tenant_required:${String(params.tenant_id ?? "")}`);

  const mat = await one<MaterialRow>(
    `SELECT id, name, price_per_bf, kerf_waste_pct, min_charge_usd,
            price_per_cuin, cost_per_ci_usd, skiving_upcharge_pct,
            cutting_setup_fee_usd, thickness_in
     FROM materials WHERE id = $1`,
    [params.material_id],
  );
  if (!mat) throw new Error(`material_not_found:${params.material_id}`);

  const settings = await getPricingSettings(tenantId);

  // Step 20: the shop's own material prices override the shared catalog.
  applyShopPrice(mat, await shopMaterialPrice(tenantId, params.material_id));

  return priceFoam(mat, settings, {
    L: params.L,
    W: params.W,
    H: params.H,
    qty: params.qty,
    cavities: params.cavities ?? [],
    cavity_ci: params.cavity_ci ?? 0,
    round_to_bf: params.round_to_bf === true,
    force_skived: params.force_skived === true,
  });
}
