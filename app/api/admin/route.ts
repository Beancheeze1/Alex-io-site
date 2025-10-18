// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";

// Path-A: use the shims you already added
import { getAccessToken } from "@/lib/oauthStore.js";
import { introspect, hsGetOwners } from "@/lib/hubspot.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // do not cache
export const revalidate = 0;

export async function GET() {
  try {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_access_token",
          hint:
            "No access token available. Run the OAuth flow at /api/auth/hubspot and ensure HUBSPOT_* envs are set.",
          env: {
            has_client_id: !!process.env.HUBSPOT_CLIENT_ID || false,
            has_client_secret: !!process.env.HUBSPOT_CLIENT_SECRET || false,
            redirect_uri: process.env.HUBSPOT_REDIRECT_URI || null,
            portal_env: process.env.HUBSPOT_PORTAL_ID || null,
          },
        },
        { status: 200 }
      );
    }

    // Ask HubSpot who this token belongs to
    const tokenInfo = await introspect(accessToken);

    // Non-fatal: try a lightweight owners call to prove CRM scope
    let ownersPreview: Array<{ id: string; email?: string }> = [];
    try {
      const owners = await hsGetOwners();
      ownersPreview = (owners || [])
        .slice(0, 3)
        .map((o: any) => ({ id: String(o.id ?? ""), email: o.email ?? undefined }));
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        ok: !!tokenInfo?.ok,
        token_ok: !!tokenInfo?.ok,
        // Useful bits from HubSpot’s introspection
        portalId: (tokenInfo as any)?.hub_id ?? null,
        user: {
          user_id: (tokenInfo as any)?.user_id ?? null,
          user: (tokenInfo as any)?.user ?? null,
        },
        scopes: (tokenInfo as any)?.scopes ?? null,
        expires_at: (tokenInfo as any)?.expires_at ?? null,
        // A tiny live permission check
        owners_preview: ownersPreview,
        // diagnostics
        env: {
          portal_env: process.env.HUBSPOT_PORTAL_ID || null,
          redirect_uri: process.env.HUBSPOT_REDIRECT_URI || null,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        reason: "whoami_error",
        error: err?.message || String(err),
      },
      { status: 500
