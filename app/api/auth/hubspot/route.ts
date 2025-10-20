// app/api/auth/hubspot/route.ts
import { NextResponse } from "next/server";
import { buildAuthUrl, saveState } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const { url, state } = buildAuthUrl(origin);
  await saveState(state);
  // Attach state on the way out
  const redirectUrl = `${url}&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(redirectUrl);
}
