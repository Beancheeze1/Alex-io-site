// app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getPricingSettings,
  updatePricingSettings,
  PricingSettings,
} from "@/app/lib/pricing/settings";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { adminOnly } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminOnly(async (req: NextRequest) => {
  const user = await getCurrentUserFromRequest(req);
  const tenantId = user?.tenant_id ?? "default";
  const settings = await getPricingSettings(tenantId);
  return NextResponse.json({ ok: true, settings }, { status: 200 });
});

type ValidationError = { field: string; message: string };

function validateNonNegative(field: string, value: any): ValidationError | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return { field, message: `${field} must be a non-negative number.` };
  }
  return null;
}

function validateMarkupFactor(value: any): ValidationError | null {
  const negative = validateNonNegative("markup_factor_default", value);
  if (negative) return negative;
  if (value === 0) {
    return {
      field: "markup_factor_default",
      message:
        "markup_factor_default cannot be zero — this would price every quote at zero cost or a loss.",
    };
  }
  return null;
}

function validateKerfPct(value: any): ValidationError | null {
  const negative = validateNonNegative("kerf_pct_default", value);
  if (negative) return negative;
  if (value > 200) {
    return {
      field: "kerf_pct_default",
      message: "kerf_pct_default cannot exceed 200%.",
    };
  }
  return null;
}

function validateCushionFamilyOrder(value: any): ValidationError | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    return {
      field: "cushion_family_order",
      message: "cushion_family_order must be an array of strings.",
    };
  }
  return null;
}

export const PATCH = adminOnly(async (req: NextRequest) => {
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

    for (const k of keys) {
      if (!(k in filtered)) continue;

      const value = (filtered as any)[k];
      let error: ValidationError | null;

      if (k === "markup_factor_default") {
        error = validateMarkupFactor(value);
      } else if (k === "kerf_pct_default") {
        error = validateKerfPct(value);
      } else if (k === "cushion_family_order") {
        error = validateCushionFamilyOrder(value);
      } else {
        error = validateNonNegative(k, value);
      }

      if (error) {
        return NextResponse.json(
          { ok: false, error: "invalid_value", field: error.field, message: error.message },
          { status: 400 },
        );
      }
    }

    const settings = await updatePricingSettings(filtered, tenantId);
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
});
