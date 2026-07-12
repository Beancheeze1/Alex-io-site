// app/api/admin/db/health/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbPing } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function inspectDbUrl() {
  const raw = process.env.DATABASE_URL || "";
  try {
    const u = new URL(raw);
    // mask sensitive bits
    return {
      present: true,
      host: u.hostname,
      port: u.port || "5432",
      database: (u.pathname || "").replace(/^\//, ""),
      sslmode: u.searchParams.get("sslmode") || "(none)",
      masked: `${u.protocol}//***:***@${u.hostname}:${u.port}${u.pathname}?sslmode=${u.searchParams.get("sslmode") || "unset"}`
    };
  } catch {
    return { present: !!raw, error: "Malformed DATABASE_URL" };
  }
}

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const info = inspectDbUrl();

  try {
    const ok = await dbPing();
    return NextResponse.json({ ok, driver: "postgres", info });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e), info },
      { status: 500 }
    );
  }
}
