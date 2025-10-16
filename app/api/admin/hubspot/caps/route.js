import { NextResponse } from "next/server";
import { fetchCaps } from "@/lib/hubspotCaps.js";
export const runtime = "nodejs";

export async function GET(req) {
  const url = new URL(req.url);
  const hubId = url.searchParams.get("hubId");
  if (!hubId) return NextResponse.json({ ok:false, error:"hubId required" }, { status:400 });
  try {
    const caps = await fetchCaps(hubId);
    return NextResponse.json({ ok:true, quotingMode: caps.quotingMode, scopes: [...caps.scopes] });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e) }, { status:500 });
  }
}
