// app/api/admin/debug/env/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const mask = (s?:string) => s ? (s.length<=12 ? "***" : `${s.slice(0,6)}...${s.slice(-6)}`) : null;

export async function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL || null;
  return NextResponse.json({
    ok:true,
    base,
    env: {
      HUBSPOT_CLIENT_ID:     mask(process.env.HUBSPOT_CLIENT_ID),
      HUBSPOT_CLIENT_SECRET: !!process.env.HUBSPOT_CLIENT_SECRET,
      HUBSPOT_REFRESH_TOKEN: !!process.env.HUBSPOT_REFRESH_TOKEN,
    }
  });
}
