// app/api/parse/email-quote/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { parseEmailToQuote } from "@/lib/parseQuote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

async function resolveMaterialId(hint?: { density_lb_ft3?: number; name_like?: string }) {
  if (!hint) return null;
  const pool = getPool();
  // nearest density among materials that match the family (PE/EPE/XLPE) if provided
  const { rows } = await pool.query(
    `SELECT id, name, density_lb_ft3
       FROM public.materials
      WHERE ($1::text IS NULL OR upper(name) LIKE '%'||upper($1)||'%')
      ORDER BY ABS(density_lb_ft3 - COALESCE($2::numeric, density_lb_ft3)) ASC
      LIMIT 1`,
    [hint.name_like ?? null, hint.density_lb_ft3 ?? null]
  );
  return rows[0]?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json(); // { text: string }
    const text = String(body?.text || "");
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

    const parsed = parseEmailToQuote(text);
    const material_id = await resolveMaterialId(parsed.material_hint);

    // Build quote payload expected by /api/quote/foam
    const payload = {
      length_in: parsed.length_in,
      width_in:  parsed.width_in,
      height_in: parsed.height_in,
      qty: parsed.qty ?? 1,
      material_id: material_id ?? 1, // fallback (you can choose a safer default)
      cavities: parsed.cavities.map(c => ({
        label: c.label,
        count: c.count,
        l: c.cav_length_in,
        w: c.cav_width_in,
        d: c.cav_depth_in,
      }))
    };

    // If we’re missing critical dims, tell the bot to ask a follow-up
    if (!(payload.length_in && payload.width_in && payload.height_in)) {
      return NextResponse.json({ parsed, need_more: ["length_in","width_in","height_in"].filter(k => !(payload as any)[k]) }, { status: 200 });
    }

    // Call your existing quote endpoint/function to price it
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/quote/foam`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // avoid Next internal cache
      cache: "no-store",
    });

    const price = await r.json().catch(() => ({}));
    return NextResponse.json({ parsed, payload, price }, { status: r.ok ? 200 : 207 });

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
