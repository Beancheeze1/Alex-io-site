import { NextResponse } from "next/server";
import { buildAuthUrl, saveState } from "@/lib/hubspot";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  requireEnv();

  const { url, state } = buildAuthUrl();

  // Save for server-side verification
  await saveState(state);

  // Also set a short-lived cookie as a dev-friendly fallback
  const res = NextResponse.redirect(`${url}&state=${state}`, { status: 302 });
  res.cookies.set("hs_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
