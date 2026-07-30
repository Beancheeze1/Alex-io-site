// app/api/admin/boxes/route.ts
//
// Admin Carton Pricing API
// Path A safe: read & update carton pricing + tiers only.
// - GET:  list boxes + box_price_tiers (if present)
//   * If the box_price_tiers table or columns are missing/mismatched,
//     we gracefully fall back to returning boxes with NULL tier fields.
// - POST: save pricing for boxes (base price + up to 4 tiers)
//
// IMPORTANT:
// - Does NOT touch quote_items, quote_box_selections, or foam logic.
// - Allows NULL prices (blank inputs) and NULL tier mins.
// - Prices stored as numeric(12,2) (2 decimals).

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { validateBoxTierOrdering } from "@/app/lib/box-tier-pricing";
import { requireAdmin } from "@/lib/admin-auth";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BoxWithTiersRow = {
  box_id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: string | number;
  inside_width_in: string | number;
  inside_height_in: string | number;
  tenant_id: number | null;

  tier_id: number | null;
  base_unit_price: string | number | null;
  tier1_min_qty: number | null;
  tier1_unit_price: string | number | null;
  tier2_min_qty: number | null;
  tier2_unit_price: string | number | null;
  tier3_min_qty: number | null;
  tier3_unit_price: string | number | null;
  tier4_min_qty: number | null;
  tier4_unit_price: string | number | null;
};

type BoxOnlyRow = {
  box_id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: string | number;
  inside_width_in: string | number;
  inside_height_in: string | number;
  tenant_id: number | null;
};

type SaveUpdate = {
  box_id: number;
  tier_id?: number | null;
  base_unit_price?: string | number | null;
  tier1_min_qty?: string | number | null;
  tier1_unit_price?: string | number | null;
  tier2_min_qty?: string | number | null;
  tier2_unit_price?: string | number | null;
  tier3_min_qty?: string | number | null;
  tier3_unit_price?: string | number | null;
  tier4_min_qty?: string | number | null;
  tier4_unit_price?: string | number | null;
};

type SavePayload = {
  updates: SaveUpdate[];
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function toNullableNumber(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNullableInt(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded <= 0) return null;
  return rounded;
}

// ---------- GET: list boxes + tiers (with safe fallback) ----------
export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  // Best-effort tenant resolution for scoping: a real session tells us which
  // tenant's custom boxes to include alongside the shared global catalog.
  // Falls back to global-only when no tenant can be resolved (e.g. an
  // x-admin-key caller with no session) -- this only ever narrows what's
  // visible, never widens it, so it can't leak another tenant's rows.
  const currentUser = await getCurrentUserFromRequest(req);
  const tenantResult = await enforceTenantMatch(req, currentUser);
  const tenantId = tenantResult.ok && tenantResult.tenant_id ? tenantResult.tenant_id : null;

  try {
    try {
      // Preferred path: join boxes + box_price_tiers
      const rows = await q<BoxWithTiersRow>(
        `
        select
          b.id as box_id,
          b.vendor,
          b.style,
          b.sku,
          b.description,
          b.inside_length_in,
          b.inside_width_in,
          b.inside_height_in,
          b.tenant_id,
          t.id as tier_id,
          t.base_unit_price,
          t.tier1_min_qty,
          t.tier1_unit_price,
          t.tier2_min_qty,
          t.tier2_unit_price,
          t.tier3_min_qty,
          t.tier3_unit_price,
          t.tier4_min_qty,
          t.tier4_unit_price
        from public.boxes b
        left join public.box_price_tiers t
          on t.box_id = b.id
        where b.active = true
          and (b.tenant_id is null or b.tenant_id = $1)
        order by b.vendor, b.style, b.sku
        `,
        [tenantId],
      );

      return ok({
        ok: true,
        boxes: rows,
      });
    } catch (innerErr: any) {
      const msg = String(innerErr?.message ?? innerErr ?? "");
      const code = (innerErr && (innerErr as any).code) || "";

      // If the error looks like a missing table / bad column on box_price_tiers,
      // fall back to boxes-only so the UI still works.
      const isTierSchemaProblem =
        code === "42P01" || // undefined_table
        code === "42703" || // undefined_column
        msg.includes("box_price_tiers");

      if (!isTierSchemaProblem) {
        throw innerErr;
      }

      console.warn(
        "[/api/admin/boxes] box_price_tiers not ready; falling back to boxes-only:",
        { code, msg },
      );

      const boxesOnly = await q<BoxOnlyRow>(
        `
        select
          b.id as box_id,
          b.vendor,
          b.style,
          b.sku,
          b.description,
          b.inside_length_in,
          b.inside_width_in,
          b.inside_height_in,
          b.tenant_id
        from public.boxes b
        where b.active = true
          and (b.tenant_id is null or b.tenant_id = $1)
        order by b.vendor, b.style, b.sku
        `,
        [tenantId],
      );

      const boxesWithNullTiers: BoxWithTiersRow[] = boxesOnly.map((b) => ({
        ...b,
        tier_id: null,
        base_unit_price: null,
        tier1_min_qty: null,
        tier1_unit_price: null,
        tier2_min_qty: null,
        tier2_unit_price: null,
        tier3_min_qty: null,
        tier3_unit_price: null,
        tier4_min_qty: null,
        tier4_unit_price: null,
      }));

      return ok({
        ok: true,
        boxes: boxesWithNullTiers,
      });
    }
  } catch (err: any) {
    console.error("Error in GET /api/admin/boxes:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading carton pricing. Please try again.",
      },
      500,
    );
  }
}

// ---------- POST: save pricing updates ----------
export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  try {
    const body = (await req.json()) as SavePayload | null;
    if (!body || !Array.isArray(body.updates)) {
      return bad(
        {
          ok: false,
          error: "INVALID_PAYLOAD",
          message: "Expected { updates: [...] }.",
        },
        400,
      );
    }

    let applied = 0;
    const warnings: Array<{ box_id: number; messages: string[] }> = [];

    for (const u of body.updates) {
      const boxId = Number(u.box_id);
      if (!Number.isFinite(boxId) || boxId <= 0) {
        continue;
      }

      const base_unit_price = toNullableNumber(u.base_unit_price);
      const tier1_min_qty = toNullableInt(u.tier1_min_qty);
      const tier1_unit_price = toNullableNumber(u.tier1_unit_price);
      const tier2_min_qty = toNullableInt(u.tier2_min_qty);
      const tier2_unit_price = toNullableNumber(u.tier2_unit_price);
      const tier3_min_qty = toNullableInt(u.tier3_min_qty);
      const tier3_unit_price = toNullableNumber(u.tier3_unit_price);
      const tier4_min_qty = toNullableInt(u.tier4_min_qty);
      const tier4_unit_price = toNullableNumber(u.tier4_unit_price);

      const orderWarnings = validateBoxTierOrdering({
        base_unit_price,
        tier1_min_qty,
        tier1_unit_price,
        tier2_min_qty,
        tier2_unit_price,
        tier3_min_qty,
        tier3_unit_price,
        tier4_min_qty,
        tier4_unit_price,
      });
      if (orderWarnings.length > 0) {
        warnings.push({
          box_id: boxId,
          messages: orderWarnings.map((w) => w.message),
        });
      }

      const tierId = u.tier_id != null ? Number(u.tier_id) : null;

      if (tierId && Number.isFinite(tierId) && tierId > 0) {
        // Update existing tier row
        await q(
          `
          update public.box_price_tiers
          set
            base_unit_price = $1,
            tier1_min_qty = $2,
            tier1_unit_price = $3,
            tier2_min_qty = $4,
            tier2_unit_price = $5,
            tier3_min_qty = $6,
            tier3_unit_price = $7,
            tier4_min_qty = $8,
            tier4_unit_price = $9
          where id = $10
            and box_id = $11
          `,
          [
            base_unit_price,
            tier1_min_qty,
            tier1_unit_price,
            tier2_min_qty,
            tier2_unit_price,
            tier3_min_qty,
            tier3_unit_price,
            tier4_min_qty,
            tier4_unit_price,
            tierId,
            boxId,
          ],
        );
        applied += 1;
      } else {
        // Insert new tier row for this box
        await q(
          `
          insert into public.box_price_tiers (
            box_id,
            base_unit_price,
            tier1_min_qty,
            tier1_unit_price,
            tier2_min_qty,
            tier2_unit_price,
            tier3_min_qty,
            tier3_unit_price,
            tier4_min_qty,
            tier4_unit_price
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          on conflict (box_id) do update
          set
            base_unit_price = excluded.base_unit_price,
            tier1_min_qty = excluded.tier1_min_qty,
            tier1_unit_price = excluded.tier1_unit_price,
            tier2_min_qty = excluded.tier2_min_qty,
            tier2_unit_price = excluded.tier2_unit_price,
            tier3_min_qty = excluded.tier3_min_qty,
            tier3_unit_price = excluded.tier3_unit_price,
            tier4_min_qty = excluded.tier4_min_qty,
            tier4_unit_price = excluded.tier4_unit_price
          `,
          [
            boxId,
            base_unit_price,
            tier1_min_qty,
            tier1_unit_price,
            tier2_min_qty,
            tier2_unit_price,
            tier3_min_qty,
            tier3_unit_price,
            tier4_min_qty,
            tier4_unit_price,
          ],
        );
        applied += 1;
      }
    }

    return ok({
      ok: true,
      applied,
      warnings,
    });
  } catch (err: any) {
    console.error("Error in POST /api/admin/boxes:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem saving carton pricing. Please try again.",
      },
      500,
    );
  }
}

// ---------- PUT: create a new box/mailer size (tenant-scoped) ----------

type CreateBoxPayload = {
  vendor?: string;
  style?: string;
  sku?: string;
  description?: string;
  inside_length_in?: string | number;
  inside_width_in?: string | number;
  inside_height_in?: string | number;
  min_order_qty?: string | number | null;
  bundle_qty?: string | number | null;
  notes?: string | null;
  base_unit_price?: string | number | null;
  tier1_min_qty?: string | number | null;
  tier1_unit_price?: string | number | null;
  tier2_min_qty?: string | number | null;
  tier2_unit_price?: string | number | null;
  tier3_min_qty?: string | number | null;
  tier3_unit_price?: string | number | null;
  tier4_min_qty?: string | number | null;
  tier4_unit_price?: string | number | null;
};

// Matches the only two style values box-suggestion logic ever checks against
// (case-insensitively) elsewhere in the app -- anything else would silently
// never surface in a real quote's box suggestions.
const VALID_BOX_STYLES = ["RSC", "Mailer"];

function toPositiveNumber(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toNonNegativePrice(raw: any): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

export async function PUT(req: NextRequest) {
  // Creation needs a real tenant-scoped session -- unlike GET/POST above,
  // there's no safe default for "which tenant does this new row belong to,"
  // so (unlike requireAdmin's x-admin-key bypass) this always requires a
  // logged-in admin.
  const current = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(current, ["admin"])) {
    return bad(
      { ok: false, error: "forbidden", message: "Admin role required." },
      403,
    );
  }

  const ten = await enforceTenantMatch(req, current);
  if (!ten.ok) {
    return NextResponse.json(ten.body, { status: ten.status });
  }
  if (!current || typeof current.tenant_id !== "number") {
    return bad(
      {
        ok: false,
        error: "tenant_required",
        message:
          "Your admin account is missing a tenant assignment, so there's no catalog to add this to.",
      },
      403,
    );
  }
  const tenantId = current.tenant_id;

  try {
    const body = (await req.json().catch(() => null)) as CreateBoxPayload | null;
    if (!body) {
      return bad(
        {
          ok: false,
          error: "INVALID_PAYLOAD",
          message: "Expected a JSON body describing the new box/mailer size.",
        },
        400,
      );
    }

    // Collect every validation problem at once (not just the first) so the
    // admin fixes everything in one pass instead of a frustrating trickle.
    const fieldErrors: Record<string, string> = {};

    const vendor = String(body.vendor ?? "").trim();
    if (!vendor) fieldErrors.vendor = "Vendor is required.";

    const styleRaw = String(body.style ?? "").trim();
    const styleMatch = VALID_BOX_STYLES.find(
      (s) => s.toLowerCase() === styleRaw.toLowerCase(),
    );
    if (!styleMatch) {
      fieldErrors.style = `Style must be one of: ${VALID_BOX_STYLES.join(", ")}.`;
    }

    const sku = String(body.sku ?? "").trim();
    if (!sku) fieldErrors.sku = "SKU is required.";

    const description = String(body.description ?? "").trim();
    if (!description) fieldErrors.description = "Description is required.";

    const insideL = toPositiveNumber(body.inside_length_in);
    if (insideL == null) {
      fieldErrors.inside_length_in = "Inside length must be a number greater than 0.";
    }
    const insideW = toPositiveNumber(body.inside_width_in);
    if (insideW == null) {
      fieldErrors.inside_width_in = "Inside width must be a number greater than 0.";
    }
    const insideH = toPositiveNumber(body.inside_height_in);
    if (insideH == null) {
      fieldErrors.inside_height_in = "Inside height must be a number greater than 0.";
    }

    const minOrderQty = toNullableInt(body.min_order_qty);
    const bundleQty = toNullableInt(body.bundle_qty);
    const notes =
      body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

    const priceInputs: [string, any][] = [
      ["base_unit_price", body.base_unit_price],
      ["tier1_unit_price", body.tier1_unit_price],
      ["tier2_unit_price", body.tier2_unit_price],
      ["tier3_unit_price", body.tier3_unit_price],
      ["tier4_unit_price", body.tier4_unit_price],
    ];
    const prices: Record<string, number | null> = {};
    for (const [key, raw] of priceInputs) {
      const res = toNonNegativePrice(raw);
      if (!res.ok) {
        fieldErrors[key] = "Price can't be negative.";
      } else {
        prices[key] = res.value;
      }
    }

    const tier1_min_qty = toNullableInt(body.tier1_min_qty);
    const tier2_min_qty = toNullableInt(body.tier2_min_qty);
    const tier3_min_qty = toNullableInt(body.tier3_min_qty);
    const tier4_min_qty = toNullableInt(body.tier4_min_qty);

    if (Object.keys(fieldErrors).length > 0) {
      return bad(
        {
          ok: false,
          error: "VALIDATION_FAILED",
          message: "Fix the highlighted fields and try again.",
          fieldErrors,
        },
        400,
      );
    }

    // SKU is used as a lookup key elsewhere (add-to-quote, layout apply) --
    // a duplicate would make those lookups ambiguous, so it must be unique
    // across the whole catalog, not just this tenant's own rows.
    const existingSku = await one<{ id: number }>(
      `select id from public.boxes where lower(sku) = lower($1) limit 1`,
      [sku],
    );
    if (existingSku) {
      return bad(
        {
          ok: false,
          error: "VALIDATION_FAILED",
          message: "That SKU already exists in the catalog. SKUs must be unique.",
          fieldErrors: { sku: "This SKU is already in use." },
        },
        400,
      );
    }

    const created = await one<{ id: number }>(
      `
      insert into public.boxes (
        vendor, style, sku, description,
        inside_length_in, inside_width_in, inside_height_in,
        min_order_qty, bundle_qty, notes,
        active, tenant_id
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
      returning id
      `,
      [
        vendor,
        styleMatch,
        sku,
        description,
        insideL,
        insideW,
        insideH,
        minOrderQty,
        bundleQty,
        notes,
        tenantId,
      ],
    );

    if (!created) {
      return bad(
        {
          ok: false,
          error: "SERVER_ERROR",
          message: "The new box/mailer size could not be saved. Please try again.",
        },
        500,
      );
    }

    const hasAnyPricing =
      prices.base_unit_price != null ||
      tier1_min_qty != null ||
      tier2_min_qty != null ||
      tier3_min_qty != null ||
      tier4_min_qty != null;

    let tierWarnings: string[] = [];
    if (hasAnyPricing) {
      const orderWarnings = validateBoxTierOrdering({
        base_unit_price: prices.base_unit_price,
        tier1_min_qty,
        tier1_unit_price: prices.tier1_unit_price,
        tier2_min_qty,
        tier2_unit_price: prices.tier2_unit_price,
        tier3_min_qty,
        tier3_unit_price: prices.tier3_unit_price,
        tier4_min_qty,
        tier4_unit_price: prices.tier4_unit_price,
      });
      tierWarnings = orderWarnings.map((w) => w.message);

      await q(
        `
        insert into public.box_price_tiers (
          box_id, base_unit_price,
          tier1_min_qty, tier1_unit_price,
          tier2_min_qty, tier2_unit_price,
          tier3_min_qty, tier3_unit_price,
          tier4_min_qty, tier4_unit_price
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          created.id,
          prices.base_unit_price,
          tier1_min_qty,
          prices.tier1_unit_price,
          tier2_min_qty,
          prices.tier2_unit_price,
          tier3_min_qty,
          prices.tier3_unit_price,
          tier4_min_qty,
          prices.tier4_unit_price,
        ],
      );
    }

    return ok({
      ok: true,
      box_id: created.id,
      warnings: tierWarnings,
    });
  } catch (err: any) {
    console.error("Error in PUT /api/admin/boxes:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem creating the new box/mailer size. Please try again.",
      },
      500,
    );
  }
}
