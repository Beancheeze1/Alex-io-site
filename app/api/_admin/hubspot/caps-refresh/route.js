import { NextResponse } from "next/server";
import { getHubSpotCaps, invalidateHubSpotCaps } from "../../../../lib/hubspotCaps.js";

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok:false, status:500, error:"ADMIN_KEY missing" };
  if (sent !== need) return { ok:false, status:401, error:"Unauthorized" };
  return { ok:true };
}

export async function POST(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json({ ok:false, error: auth.error }, { status: auth.status });

  invalidateHubSpotCaps();
  const caps = await getHubSpotCaps({ forceRefresh: true });
  return NextResponse.json({ ok: true, quotingMode: caps.quotingMode, can: caps.can, probes: caps.probes });
}
