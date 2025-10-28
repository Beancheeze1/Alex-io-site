import { NextResponse } from "next/server";
import { Pool } from "pg";

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

export async function DELETE(_: Request, { params }: { params: { id: string; cavityId: string } }) {
  const productId = Number(params.id);
  const cavityId = Number(params.cavityId);
  if (!Number.isInteger(productId) || !Number.isInteger(cavityId)) {
    return NextResponse.json({ error: "bad ids" }, { status: 400 });
  }
  try {
    const { rowCount } = await getPool().query(
      `DELETE FROM public.product_cavities WHERE id = $1 AND product_id = $2;`,
      [cavityId, productId]
    );
    return rowCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
