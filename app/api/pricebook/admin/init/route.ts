// app/api/pricebook/admin/init/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { DDL } from "@/lib/pricebook/sql";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    await pool.query(DDL);
    return NextResponse.json({ ok: true, createdOrExists: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
