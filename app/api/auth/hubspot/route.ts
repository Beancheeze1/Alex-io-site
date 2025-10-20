// app/api/auth/hubspot/route.ts
// ❌ Do NOT import this file anywhere. Next.js discovers it by path.
// If you need shared logic, import from "@/lib/auth-start" instead.

import { NextResponse } from "next/server";
import { buildAuthUrl, saveState } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const { url, state } = buildAuthUrl(origin);
  await saveState(state);
  return NextResponse.redirect(`${url}&state=${encodeURIComponent(state)}`);
}

// Ensure this file is always treated as a module by TS.
export {};
