// app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getPricingSettings,
  updatePricingSettings,
  PricingSettings,
} from "@/app/lib/pricing/settings";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const tenantId = user?.tenant_id ?? "default";
  const settings = await getPricingSettings(tenantId);
  return NextResponse.json({ ok: true, settings }, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const tenantId = user.tenant_id ?? "default";

    const body = (await req.json()) as Partial<PricingSettings>;

    const keys: (keyof PricingSettings)[] = [
      "skive_upcharge_each",
      "ratePerCI_default",
      "ratePerBF_default",
      "kerf_pct_default",
      "min_charge_default",
      "printing_upcharge_usd",
      "printing_upcharge_pct",
      "machining_in3_per_min",
      "machine_cost_per_min",
      "markup_factor_default",
      "cushion_family_order",
    ];

    const filtered: Partial<PricingSettings> = {};
    for (const k of keys) {
      if (k in body) (filtered as any)[k] = (body as any)[k];
    }

    const settings = await updatePricingSettings(filtered, tenantId);
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
