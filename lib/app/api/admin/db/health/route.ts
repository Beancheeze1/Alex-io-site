// app/api/admin/db/health/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db"; // or: import { db } from "../../../lib/db"; (use relative if no "@/")

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = await db().connect();
    try {
      const r = await client.query<{ now: string; ver: string }>(
        "SELECT now()::text as now, version() as ver"
      );
      return NextResponse.json({ ok: true, db: r.rows[0] });
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
