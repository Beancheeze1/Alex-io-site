import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/oauthStore.js";
import { introspect, hsGetOwners } from "@/lib/hubspot.js";

const HS_API = "https://api.hubapi.com";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!process.env.BOT_ADMIN_ENABLED) {
    return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
  }
  try {
    const token = await getAccessToken();
    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_access_token",
          hint: "Run OAuth at /api/auth/hubspot or set HUBSPOT_PRIVATE_APP_TOKEN.",
          env: {
            has_client_id: !!process.env.HUBSPOT_CLIENT_ID,
            has_client_secret: !!process.env.HUBSPOT_CLIENT_SECRET,
            redirect_uri: process.env.HUBSPOT_REDIRECT_URI ?? null,
            portal_env: process.env.HUBSPOT_PORTAL_ID ?? null
          }
        },
        { status: 200 }
      );
    }

    // Try OAuth introspection first
    const info: any = await introspect(token);
    if (info?.ok) {
      let owners_preview: Array<{ id: string; email?: string }> = [];
      try {
        const owners = await hsGetOwners();
        owners_preview = (owners || []).slice(0, 3).map((o: any) => ({
          id: String(o.id ?? ""), email: o.email ?? undefined
        }));
      } catch {}
      return NextResponse.json(
        {
          ok: true,
          token_type: "oauth",
          portalId: info?.hub_id ?? null,
          user: { user_id: info?.user_id ?? null, user: info?.user ?? null },
          scopes: info?.scopes ?? null,
          expires_at: info?.expires_at ?? null,
          owners_preview
        },
        { status: 200 }
      );
    }

    // Fallback: Private App token probe
    const paRes = await fetch(`${HS_API}/integrations/v1/me`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store"
    });

    if (paRes.ok) {
      const me = await paRes.json().catch(() => ({}));
      let owners_preview: Array<{ id: string; email?: string }> = [];
      try {
        const owners = await hsGetOwners();
        owners_preview = (owners || []).slice(0, 3).map((o: any) => ({
          id: String(o.id ?? ""), email: o.email ?? undefined
        }));
      } catch {}
      return NextResponse.json(
        {
          ok: true,
          token_type: "private_app",
          portalId: me?.portalId ?? me?.hubId ?? null,
          appId: me?.appId ?? null,
          owners_preview
        },
        { status: 200 }
      );
    }

    const detail = await paRes.text().catch(() => "");
    return NextResponse.json(
      { ok: false, reason: "unauthorized", status: paRes.status, detail },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, reason: "whoami_error", error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
