export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    HUBSPOT_ACCESS_TOKEN_present: Boolean(process.env.HUBSPOT_ACCESS_TOKEN),
    HUBSPOT_APP_ID_present: Boolean(process.env.HUBSPOT_APP_ID),
    APP_BASE_URL_present: Boolean(process.env.APP_BASE_URL),
  });
}
