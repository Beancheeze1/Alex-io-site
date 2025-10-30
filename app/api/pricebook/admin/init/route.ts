import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  CREATE_TABLES,
  ALTER_COLUMNS,
  CLEAN_INVALID,
  ADD_FKS,
  CREATE_INDEXES,
} from "@/lib/pricebook/sql";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  try {
    for (const sql of CREATE_TABLES)  await pool.query(sql);
    for (const sql of ALTER_COLUMNS)  await pool.query(sql);
    for (const sql of CLEAN_INVALID)  await pool.query(sql);
    for (const sql of ADD_FKS)        await pool.query(sql);
    for (const sql of CREATE_INDEXES) await pool.query(sql);
    return NextResponse.json({ ok: true, createdOrExists: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
