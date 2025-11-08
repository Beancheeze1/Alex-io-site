// app/api/hubspot/lookupEmail/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Back-compat shim: forward POST body to /api/hubspot/lookup
 * so older code paths keep working.
 */
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch {}

  const base =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
    "https://api.alex-io.com";

  const res = await fetch(`${base}/api/hubspot/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
