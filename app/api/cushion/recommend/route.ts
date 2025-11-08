// app/api/ai/cushion/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";
import pg from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Input (any missing will be reported in `missing[]`):
 * {
 *   family?: "PE"|"PU"|"EPE"|"EVA"|string,
 *   targetFragilityG?: number,    // product fragility (allowable G), e.g. 50
 *   productWeight_lb?: number,    // product weight in pounds
 *   contactArea_in2?: number,     // support/contact area in square inches
 *   thickness_in?: number,        // proposed foam thickness (top/bottom combined if single-piece)
 *   drop_in?: number              // drop height in inches (e.g. 24 or 36)
 * }
 *
 * Output:
 * {
 *   ok: boolean,
 *   missing: string[],
 *   calc: {
 *     staticLoad_psi?: number,  // weight / area
 *     drop_in?: number,
 *     targetFragilityG?: number
 *   },
 *   picks: Array<{
 *     family: string,
 *     density_pcf: number,
 *     thickness_in: number,
 *     staticLoadRange_psi?: { min?: number, max?: number },
 *     g_transmitted?: number,
 *     confidence: "high"|"medium"|"low"
 *   }>,
 *   diag?: any
 * }
 *
 * NOTE: This assumes you have a table/view of cushion curves like:
 *   cushion_curves(family text, density_pcf numeric, thickness_in numeric,
 *                  static_load_min_psi numeric, static_load_max_psi numeric,
 *                  drop_in numeric, g_transmitted numeric)
 * If your column names differ, we’ll remap later—Path A keeps the SQL tolerant.
 */

type In = {
  family?: string;
  targetFragilityG?: number;
  productWeight_lb?: number;
  contactArea_in2?: number;
  thickness_in?: number;
  drop_in?: number;
};

function num(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: NextRequest) {
  const diag: Record<string, any> = {};
  try {
    const body = (await req.json()) as Partial<In>;

    // Normalize inputs
    const family = (body.family || "").trim().toUpperCase() || undefined;
    const targetFragilityG = num(body.targetFragilityG);
    const productWeight_lb = num(body.productWeight_lb);
    const contactArea_in2 = num(body.contactArea_in2);
    const thickness_in = num(body.thickness_in);
    const drop_in = num(body.drop_in);

    const missing: string[] = [];
    if (!productWeight_lb) missing.push("product weight (lb)");
    if (!contactArea_in2) missing.push("contact/support area (in²)");
    if (!thickness_in) missing.push("foam thickness (in)");
    if (!drop_in) missing.push("drop height (in)");
    if (!targetFragilityG) missing.push("target fragility (allowable G)");

    // We can proceed with a recommendation only if the core 5 fields exist:
    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: true,
          missing,
          calc: {},
          picks: [],
          diag: { note: "Provide fields above to run cushion-curve match" },
        },
        { status: 200 }
      );
    }

    const staticLoad_psi = productWeight_lb! / contactArea_in2!; // lb / in²

    // DB query — tolerant to slight schema differences
    // We look for rows that match family (if provided), thickness within ±0.25in, and drop height within ±6in.
    // Then we filter by static load band that contains our staticLoad_psi and rank by g_transmitted <= targetFragilityG (closest wins).
    const cn = process.env.DATABASE_URL;
    if (!cn) {
      return NextResponse.json({ ok: false, error: "Missing env DATABASE_URL" }, { status: 500 });
    }

    const pool = new pg.Pool({ connectionString: cn, ssl: { rejectUnauthorized: false } });
    const args: any[] = [
      family || null,
      thickness_in!,
      thickness_in! + 0.25,
      thickness_in! - 0.25,
      drop_in!,
      drop_in! + 6,
      drop_in! - 6,
      staticLoad_psi!,
      staticLoad_psi!,
      targetFragilityG!,
    ];

    const sql = `
      with cc as (
        select
          coalesce(family, '') as family,
          density_pcf::numeric as density_pcf,
          thickness_in::numeric as thickness_in,
          static_load_min_psi::numeric as static_load_min_psi,
          static_load_max_psi::numeric as static_load_max_psi,
          drop_in::numeric as drop_in,
          g_transmitted::numeric as g_transmitted
        from cushion_curves
      )
      select
        family, density_pcf, thickness_in,
        static_load_min_psi, static_load_max_psi,
        drop_in, g_transmitted,
        case
          when g_transmitted <= $10 then 1
          when g_transmitted <= $10 * 1.2 then 2
          else 3
        end as rank_bucket
      from cc
      where ($1::text is null or upper(family) = $1)
        and thickness_in between $3 and $2  -- ±0.25"
        and drop_in between $7 and $6       -- ±6"
        and $8 between static_load_min_psi and static_load_max_psi
      order by
        (g_transmitted - $10) asc,         -- closest under the target G
        abs(drop_in - $5) asc,
        abs(thickness_in - $2 + 0.25) asc,
        density_pcf asc
      limit 12
    `;

    const { rows } = await pool.query(sql, args);
    await pool.end();

    const picks = rows.map((r: any) => {
      const within = r.g_transmitted <= targetFragilityG!;
      const bucket = Number(r.rank_bucket);
      const confidence = within ? (bucket === 1 ? "high" : "medium") : "low";
      return {
        family: String(r.family),
        density_pcf: Number(r.density_pcf),
        thickness_in: Number(r.thickness_in),
        staticLoadRange_psi: {
          min: r.static_load_min_psi != null ? Number(r.static_load_min_psi) : undefined,
          max: r.static_load_max_psi != null ? Number(r.static_load_max_psi) : undefined,
        },
        drop_in: Number(r.drop_in),
        g_transmitted: Number(r.g_transmitted),
        confidence,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        missing: [],
        calc: { staticLoad_psi, drop_in, targetFragilityG },
        picks,
        diag: { matched: picks.length, family: family || "(any)" },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "recommendation error" }, { status: 200 });
  }
}
