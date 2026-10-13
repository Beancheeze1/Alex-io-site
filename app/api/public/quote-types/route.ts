// app/api/public/quote-types/route.ts
//
// GET /api/public/quote-types[?tenant=<slug>]  (Step 11)
// -> { ok, tenant_slug, quote_types: ("foam_insert"|"complete_pack"|"boxes_only")[] }
//
// Which quote types the shop offers. Shop resolution:
//   1. a real tenant subdomain (x-tenant-slug other than "default"),
//   2. ?tenant=<slug> (the quote center / Start Quote on the core host),
//   3. the signed-in user's own shop (rep form, admin pages),
//   4. the default shop.
// Unknown shop or any failure -> every type (never blocks quoting).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { QUOTE_TYPE_KEYS, quoteTypesFromTheme } from "@/lib/quote-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

type TenantRow = { id: number; slug: string; theme_json: unknown };

function json(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const header = (req.headers.get("x-tenant-slug") || "").trim().toLowerCase();
    const param = (req.nextUrl.searchParams.get("tenant") || "").trim().toLowerCase();

    let row: TenantRow | null = null;
    if (header && header !== "default" && SLUG_RE.test(header)) {
      row = await one<TenantRow>(
        `SELECT id, slug, theme_json FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`,
        [header],
      );
    } else if (param && SLUG_RE.test(param)) {
      row = await one<TenantRow>(
        `SELECT id, slug, theme_json FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`,
        [param],
      );
    } else {
      const user = await getCurrentUserFromRequest(req).catch(() => null);
      row = user
        ? await one<TenantRow>(`SELECT id, slug, theme_json FROM public.tenants WHERE id = $1 LIMIT 1`, [
            user.tenant_id,
          ])
        : await one<TenantRow>(
            `SELECT id, slug, theme_json FROM public.tenants WHERE slug = 'default' AND active = true LIMIT 1`,
          );
    }

    return json({ ok: true, tenant_slug: row?.slug ?? null, quote_types: quoteTypesFromTheme(row?.theme_json) });
  } catch (e) {
    console.warn("[public/quote-types] lookup failed; offering every type", e);
    return json({ ok: true, tenant_slug: null, quote_types: [...QUOTE_TYPE_KEYS] });
  }
}
