import { NextResponse } from "next/server";
export async function GET() {
  const t = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  return NextResponse.json({
    ok: true,
    hasToken: !!t,
    preview: t ? `${t.slice(0,5)}…${t.slice(-5)}` : null,
  });
}
