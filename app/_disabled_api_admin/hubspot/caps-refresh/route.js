import { NextResponse } from "next/server";
import { fetchCaps } from "@/lib/hubspotCaps.js";
export const runtime = "nodejs";

export async function POST(req) {
  const { hubId } = await req.json().catch(() => ({}));
  if (!hubId) return NextResponse.json({ ok:false, error:"hubId required" }, { status:400 });
  try {
    const caps = await fetchCaps(hubId); // fetchCaps always refreshes if stale
    return NextResponse.json({ ok:true, quotingMode: caps.quotingMode, scopes: [...caps.scopes] });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e) }, { status:500 });
  }
}
