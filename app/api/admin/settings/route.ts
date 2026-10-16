// app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getPricingSettings,
  updatePricingSettings,
  PricingSettings,
} from "@/app/lib/pricing/settings";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { adminOnly } from "@/lib/admin-auth";
import { FOAM_PROCESS_KEYS } from "@/app/lib/pricing/foam-process";
import { REVIEW_SETTING_KEYS } from "@/app/lib/pricing/foam-review";
import { isEmail } from "@/app/lib/quote-mail-core";
import { isTimeZone } from "@/app/lib/reminders-core";
import { cleanFreightSettings } from "@/app/lib/freight-core";

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
      "die_cut_trigger_qty",
      "die_cut_upcharge_usd",
      "cushion_family_order",
      // Step 23: foam cutting + lamination rates
      ...FOAM_PROCESS_KEYS,
      // Step 25: review flag limits
      ...REVIEW_SETTING_KEYS,
      // Step 28: quote terms
      "quote_valid_days",
      "lead_time_text",
      // Step 29A: buyer status emails
      "buyer_email_accepted",
      "buyer_email_confirmed",
      "buyer_email_released",
      "buyer_email_shipped",
      "reply_to_email",
      // Step 29B: reminders
      "reminder_expiring_on",
      "reminder_expiring_days",
      "reminder_followup_on",
      "reminder_followup_days",
      "staff_digest_on",
      "staff_digest_hour",
      "staff_digest_to",
      "shop_timezone",
      // Step 30: freight table
      "freight",
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
      } else if (k === "lead_time_text") {
        // Step 28: free text shown on quotes, up to 120 characters.
        error =
          typeof value === "string" && value.length <= 120
            ? null
            : { field: k, message: "Lead time must be text of at most 120 characters." };
      } else if (k === "reminder_expiring_on" || k === "reminder_followup_on" || k === "staff_digest_on") {
        error = typeof value === "boolean" ? null : { field: k, message: `${k} must be true or false.` };
      } else if (k === "reminder_expiring_days" || k === "reminder_followup_days") {
        error =
          typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 60
            ? null
            : { field: k, message: "Reminder days must be a whole number from 1 to 60." };
      } else if (k === "staff_digest_hour") {
        error =
          typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
            ? null
            : { field: k, message: "Digest hour must be a whole number from 0 to 23." };
      } else if (k === "staff_digest_to") {
        error =
          typeof value === "string" && (value.trim() === "" || isEmail(value))
            ? null
            : { field: k, message: "Digest address must be one email address (or blank)." };
        if (!error) (filtered as Record<string, unknown>)[k] = String(value).trim();
      } else if (k === "freight") {
        // Step 30: the whole freight table, checked and filled from the defaults.
        try {
          (filtered as Record<string, unknown>)[k] = cleanFreightSettings(value, true);
          error = null;
        } catch (e) {
          error = { field: k, message: e instanceof Error ? e.message : "Freight settings are not valid." };
        }
      } else if (k === "shop_timezone") {
        error = isTimeZone(value) ? null : { field: k, message: "Time zone must be a name like America/New_York." };
      } else if (
        k === "buyer_email_accepted" ||
        k === "buyer_email_confirmed" ||
        k === "buyer_email_released" ||
        k === "buyer_email_shipped"
      ) {
        error = typeof value === "boolean" ? null : { field: k, message: `${k} must be true or false.` };
      } else if (k === "reply_to_email") {
        // Step 29A: blank, or one email address.
        error =
          typeof value === "string" && (value.trim() === "" || isEmail(value))
            ? null
            : { field: k, message: "Reply-to must be one email address (or blank)." };
        if (!error) (filtered as Record<string, unknown>)[k] = String(value).trim();
      } else if (k === "quote_valid_days") {
        error =
          typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3650
            ? null
            : { field: k, message: "Quote valid days must be a whole number from 0 to 3650." };
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
