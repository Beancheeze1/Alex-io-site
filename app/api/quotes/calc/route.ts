import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { isInternalCall } from "@/lib/internal-call";
import { applyShopPrice, resolveTenantNumericId, shopMaterialPrice } from "@/lib/material-prices";
import { priceFoam } from "@/app/lib/pricing/foam-core";

// Step 19: who may call this route and what they get back.
//   - Internal server-to-server calls (x-alexio-internal header): full result,
//     and may name the shop with tenant_id.
//   - Signed-in staff (admin / cs / sales): full result for their own shop
//     (the platform owner may pass tenant_id).
//   - Everyone else: 30/min per IP, the host's shop only, and only the totals
//     (no rates, markup, kerf, minimum or setup).
// Step 22: the math lives in app/lib/pricing/foam-core.ts (shared with
// computePricing and the foam tests). An internal call MUST name the shop
// (tenant_id): no more silent "default" settings for email / AI / sketch prices.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  length_in: number | string;
  width_in: number | string;
  height_in: number | string;
  material_id: number | string;
  qty: number | string;
  cavities?: string[] | null; // e.g., ["3x3x1", "Ø6x1"]
  round_to_bf?: boolean;
  force_skived?: boolean;
  tenant_id?: number | string | null; // shop id or slug; REQUIRED on internal (server-to-server) calls
};

type MaterialRow = {
  id: number;
  name: string;
  price_per_bf: number | null;
  kerf_waste_pct: number | null;
  min_charge_usd: number | null;
  price_per_cuin: number | null;
  cost_per_ci_usd: number | null;
  skiving_upcharge_pct: number | null;
  cutting_setup_fee_usd: number | null;
  thickness_in: number | null;
};

type CushionRow = {
  static_psi: any;
  deflect_pct: any;
  g_level: any;
  source: string | null;
};

/* -------------------------------------------------------------------------- */

function bad(msg: string, detail?: any, code = 400) {
  return NextResponse.json({ ok: false, error: msg, detail }, { status: code });
}
function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function toNum(v: any, label: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`bad_${label}`);
  }
  return n;
}

/** GET = simple usage help. (Step 19: the database function inspector is gone.) */
export async function GET() {
  return ok({
    usage: "POST JSON to compute a foam quote",
    expects: {
      length_in: "number",
      width_in: "number",
      height_in: "number",
      material_id: "integer",
      qty: "integer",
      cavities: "string[] (optional) e.g. ['2x3x0.5','Ø6x1']",
      round_to_bf: "boolean (optional)",
      force_skived: "boolean (optional)",
    },
    example: {
      length_in: 12,
      width_in: 12,
      height_in: 3,
      material_id: 1,
      qty: 250,
      cavities: ["Ø6x1"],
      round_to_bf: false,
      force_skived: false,
    },
  });
}

/**
 * POST: deterministic volumetric quote (formula: app/lib/pricing/foam-core.ts).
 *
 * - Material inputs: price_per_cuin / price_per_bf / cost_per_ci_usd,
 *   kerf_waste_pct, min_charge_usd, skiving_upcharge_pct, cutting_setup_fee_usd
 *   (the shop's own price / minimum / waste % override the catalog: Step 20).
 * - Cavities subtract volume per piece.
 * - The shop markup (markup_factor_default, 1.45 unless the shop changed it)
 *   multiplies the total before the minimum charge.
 * - A material with no price is priced at the shop's default rate and
 *   flagged needs_review.
 * - Also attaches a light-weight cushion summary when cushion_curves has data.
 */
export async function POST(req: NextRequest) {
  // Step 19: internal call, staff, or public (rate-limited, totals only).
  const internal = isInternalCall(req);
  const user = internal ? null : await getCurrentUserFromRequest(req);
  const staff = !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
  if (!internal && !staff) {
    const rate = await rateLimit(req, 30, "foam-calc");
    if (!rate.success) return rateLimitResponse(rate.reset);
  }

  let body: In;
  try {
    body = (await req.json()) as In;
  } catch {
    return bad("invalid_json");
  }

  try {
    const length_in = toNum(body.length_in, "length_in");
    const width_in = toNum(body.width_in, "width_in");
    const height_in = toNum(body.height_in, "height_in");
    const qty = toNum(body.qty, "qty");
    const material_id = toNum(body.material_id, "material_id");
    const round_to_bf = !!body.round_to_bf;
    const force_skived = body.force_skived === true;

    if (length_in <= 0 || width_in <= 0 || height_in <= 0) {
      return bad("dims_must_be_positive", { length_in, width_in, height_in });
    }
    if (qty <= 0) {
      return bad("qty_must_be_positive", { qty });
    }

    const cavitiesArr =
      Array.isArray(body.cavities) && body.cavities.length
        ? body.cavities.map((s) => String(s))
        : [];

    // Load material row
    const mat = await one<MaterialRow>(
      `
      SELECT
        id,
        name,
        price_per_bf,
        kerf_waste_pct,
        min_charge_usd,
        price_per_cuin,
        cost_per_ci_usd,
        skiving_upcharge_pct,
        cutting_setup_fee_usd,
        thickness_in
      FROM materials
      WHERE id = $1
      `,
      [material_id],
    );

    if (!mat) {
      return bad("material_not_found", { material_id });
    }

    // Load tenant-scoped pricing settings
    // Prefer explicit tenant_id from payload (server-to-server calls pass this directly).
    // Fall back to host-based subdomain lookup for direct browser/external calls.
    // Step 19: only internal calls (or the platform owner) may name the shop.
    // Staff price for their own shop; the public gets the host's shop.
    // Step 22: always a numeric shop id (settings are saved under it), and an
    // internal call must say which shop it is pricing for.
    let tenantId: number | null = null;
    const askedTenant = body.tenant_id != null && body.tenant_id !== "" ? body.tenant_id : null;
    if (askedTenant != null && (internal || (staff && isPlatformOwner(user)))) {
      tenantId = await resolveTenantNumericId(askedTenant);
      if (tenantId == null) return bad("tenant_not_found", { tenant_id: askedTenant });
    } else if (internal) {
      console.error("[quotes/calc] internal call without tenant_id — refusing to guess the shop");
      return bad("tenant_required", { message: "Internal calc calls must pass tenant_id." });
    } else if (staff && user?.tenant_id != null) {
      tenantId = Number(user.tenant_id);
    } else {
      const hostname = req.headers.get("host") || "";
      const subdomain = hostname.split(".")[0];
      const tenantRow = await one<{ id: number }>(
        `SELECT id FROM public.tenants WHERE slug = $1`,
        [subdomain],
      ).catch(() => null);
      // The core host (api.alex-io.com) is the default shop.
      tenantId = tenantRow?.id ?? (await resolveTenantNumericId("default"));
      if (tenantId == null) return bad("tenant_not_found", undefined, 404);
    }
    const settings = await getPricingSettings(tenantId);

    // Step 20: the shop's own price / minimum / waste % for this material
    // override the shared catalog (blank fields keep the catalog value).
    applyShopPrice(mat, await shopMaterialPrice(tenantId, material_id));

    // Step 22: one shared formula (app/lib/pricing/foam-core.ts).
    const priced = priceFoam(mat, settings, {
      L: length_in,
      W: width_in,
      H: height_in,
      qty,
      cavities: cavitiesArr,
      round_to_bf,
      force_skived,
    });

    // --- Cushion curve lookup (optional) ---
    let cushion: any = {
      has_data: false,
      point_count: 0,
    };

    try {
      const rows = await q<CushionRow>(
        `
        SELECT static_psi, deflect_pct, g_level, "source"
        FROM cushion_curves
        WHERE material_id = $1
        ORDER BY g_level ASC, static_psi ASC
        LIMIT 100;
        `,
        [material_id],
      );

      if (rows && rows.length > 0) {
        const points = rows
          .map((r) => ({
            static_psi: Number(r.static_psi),
            // deflect_pct is not present in the source chart for most rows;
            // stays null rather than Number(null) silently becoming 0.
            deflect_pct: r.deflect_pct == null ? null : Number(r.deflect_pct),
            g_level: Number(r.g_level),
            source: r.source || null,
          }))
          .filter(
            (p) =>
              Number.isFinite(p.static_psi) &&
              Number.isFinite(p.g_level),
          )
          .sort((a, b) => a.g_level - b.g_level || a.static_psi - b.static_psi);

        if (points.length > 0) {
          const best = points[0];
          cushion = {
            has_data: true,
            point_count: points.length,
            best_point: best,
            points: points.slice(0, 10), // keep it light
          };
        }
      }
    } catch (err) {
      // Keep quote calc robust even if cushion table has issues
      console.error("cushion curve lookup error:", err);
    }

    const result = {
      ...priced,
      // Cushion curve summary (if available)
      cushion,
    };

    // Step 19: the public sees the price, not how it's built.
    if (!internal && !staff) {
      return ok({
        variant_used: "ts_volumetric_v1",
        result: {
          total: result.total,
          used_min_charge: result.used_min_charge,
          piece_ci: result.piece_ci,
          material_name: result.material_name,
        },
      });
    }

    return ok({
      input: {
        length_in,
        width_in,
        height_in,
        material_id,
        qty,
        cavities: cavitiesArr,
        round_to_bf,
        force_skived,
      },
      variant_used: "ts_volumetric_v1",
      result,
    });
  } catch (e: any) {
    console.error("[quotes/calc] failed:", e);
    return bad("calc_exception", internal || staff ? { message: String(e?.message || e) } : undefined, 500);
  }
}