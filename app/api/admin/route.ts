import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { hsGetOwners } from '@/lib/hubspot';
import { kvPing } from '@/lib/kv';
export const revalidate = 0;
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      endpoints: [
        { path: "/api/health", purpose: "Liveness" },
        { path: "/api/admin", purpose: "This index" },
        { path: "/api/admin/whoami", purpose: "OAuth/portal/scopes check" },
        { path: "/api/auth/hubspot", purpose: "Begin OAuth" },
        { path: "/api/auth/hubspot/callback", purpose: "OAuth callback" }
      ]
    },
    { status: 200 }
  );
}
