// app/api/pricebook/export/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { PriceBook } from "@/lib/pricebook/schema";

export const dynamic = "force-dynamic";

// ---------- helpers ----------
function toNum(v: any, d = 0): number {
  if (v === null || v === undefined || v === "") return d;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}
function toStr(v: any, d = ""): string {
  if (v === null || v === undefined) return d;
  return String(v).trim();
}
function cleanDims(input: any) {
  if (!input || typeof input !== "object") return {};
  const x = toNum((input as any).x, undefined as any);
  const y = toNum((input as any).y, undefined as any);
  const z = toNum((input as any).z, undefined as any);
  const out: any = {};
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  if (z !== undefined) out.z = z;
  return out;
}
// Turn an integer into a format-valid UUID string (passes z.string().uuid())
function intToUUID(id: any): string {
  const n = Number(id);
  const hex = Number.isFinite(n) ? n.toString(16).padStart(12, "0").slice(-12) : "000000000000";
  return `00000000-0000-0000-0000-${hex}`;
}

const APPLIES_ALLOWED = new Set(["material", "product", "cavity"]);
const METRIC_ALLOWED  = new Set(["per_cu_in", "flat", "tiered"]);

// ---------- route ----------
export async function GET() {
  try {
    const pool = getPool();

    const [materialsQ, cavitiesQ, rulesQ, productsQ] = await Promise.all([
      pool.query(
        `SELECT material_uid, name, density_lb_ft3, supplier_code
         FROM materials ORDER BY name`
      ),
      pool.query(
        `SELECT id, shape, dims, volume_ci, notes
         FROM cavities ORDER BY id`
      ),
      pool.query(
        `SELECT rule_uid, applies_to, metric, formula
         FROM price_rules ORDER BY rule_uid`
      ),
      pool.query(
        `SELECT id, sku, description, dims, volume_ci, material_ref, rule_ref
         FROM products ORDER BY sku`
      ),
    ]);

    const materials = materialsQ.rows.map((r: any) => ({
      id: toStr(r.material_uid),
      name: toStr(r.name),
      density_lb_ft3: toNum(r.density_lb_ft3),
      supplier_code: toStr(r.supplier_code, ""),
    }));

    const cavities = cavitiesQ.rows.map((r: any) => ({
      id: toStr(r.id),
      shape: toStr(r.shape || "rect"),
      dims: cleanDims(r.dims),
      volume_ci: toNum(r.volume_ci),
      notes: r.notes == null ? undefined : toStr(r.notes),
    }));

    const price_rules = rulesQ.rows.map((r: any) => {
      const appliesRaw = toStr(r.applies_to || "product");
      const metricRaw  = toStr(r.metric || "per_cu_in");
      const applies_to = APPLIES_ALLOWED.has(appliesRaw) ? appliesRaw : "product";
      const metric     = METRIC_ALLOWED.has(metricRaw)  ? metricRaw  : "per_cu_in";
      const formula    = r.formula && typeof r.formula === "object" ? r.formula : {};
      return {
        id: toStr(r.rule_uid),
        applies_to,
        metric,
        formula,
      };
    });

    const products = productsQ.rows.map((r: any) => {
      const out: any = {
        // DB has integer ids; manifest requires UUID → coerce to UUID-shaped string
        id: /^[0-9a-f-]{36}$/i.test(String(r.id)) ? toStr(r.id) : intToUUID(r.id),
        sku: toStr(r.sku),
        description: r.description == null ? undefined : toStr(r.description),
        dims: cleanDims(r.dims),
        volume_ci: toNum(r.volume_ci),
      };
      if (r.material_ref) out.material_ref = toStr(r.material_ref);
      if (r.rule_ref)     out.rule_ref     = toStr(r.rule_ref);
      return out;
    });

    const manifest = {
      name: "Alex-IO Default Price Book",
      version: "1.0.0",
      currency: "USD",
      created_at: new Date().toISOString(),
      tables: { materials, cavities, price_rules, products },
    };

    const parsed = PriceBook.safeParse(manifest);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid manifest", issues: parsed.error.format() },
        { status: 500 }
      );
    }

    return new NextResponse(JSON.stringify(parsed.data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="pricebook-${parsed.data.version}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
