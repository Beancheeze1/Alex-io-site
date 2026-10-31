// app/api/public/shop-asset/[id]/route.ts
//
// Step 46: serves a shop's uploaded logo or banner photo (tenant_assets) to
// anyone, as on its Quotes & ordering page. A file never changes once stored
// (a new upload gets a new id), so it is cached for a year. Not found (or
// migration 052 not run yet) -> 404.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { shopAssetsReady } from "@/app/lib/shop-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.pathname.split("/").filter(Boolean).pop() || "";
  if (!/^\d{1,18}$/.test(raw)) return notFound();
  if (!(await shopAssetsReady())) return notFound();
  const row = await one<{ content_type: string; data: Buffer; sha256: string }>(
    `SELECT content_type, data, sha256 FROM public.tenant_assets WHERE id = $1`,
    [raw],
  ).catch(() => null);
  if (!row) return notFound();
  const type = ["image/png", "image/jpeg", "image/webp"].includes(row.content_type) ? row.content_type : "application/octet-stream";
  const etag = `"${row.sha256}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  return new NextResponse(new Uint8Array(row.data), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(row.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
