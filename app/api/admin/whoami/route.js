export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { resolveTenantFromRequest } from "../../../../lib/tenancy.js";
import { whoAmIWithToken } from "../../../../lib/hubspot-tenant.js";

export async function GET(req) {
  try {
    const { tenantId, cfg } = resolveTenantFromRequest(req);
    const me = await whoAmIWithToken(cfg.env.HUBSPOT_ACCESS_TOKEN);
    return NextResponse.json({ ok: true, tenantId, me });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
