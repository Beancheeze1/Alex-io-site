import { NextResponse } from "next/server";
import { buildAuthUrl, saveState } from "@/lib/hubspot";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const { url, state } = buildAuthUrl(origin);
  await saveState(state);
  return NextResponse.redirect(`${url}&state=${encodeURIComponent(state)}`);
}
