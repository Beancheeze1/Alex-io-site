// app/api/tenant/context/route.ts
//
// Debug endpoint: proves middleware tenant header injection works.
// GET /api/tenant/context
//
// Returns host + x-tenant-slug as seen by the Node route.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    host: req.headers.get("host"),
    tenant_slug: req.headers.get("x-tenant-slug"),
  });
}