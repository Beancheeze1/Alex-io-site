// app/api/admin/shop-page/route.ts
//
// Step 45: Shop settings → Shop page. A shop's admins read and change their
// own Quotes & ordering page (logo, colors, banner, intro, About, stats,
// products, contact, chat widget) — the fields in lib/shop-page-edit.ts.
//   GET  -> { ok, slug, name, brandName, page_url, quote_displays, values }
//   POST { changes } -> saves only the fields sent, merged into the shop's
//        saved theme in one UPDATE (so two people saving different fields
//        never undo each other), -> { ok, values, ignored }
// Admins of the shop only (their own shop, from their login).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { cleanShopPagePatch, shopPageUrl, shopPageValues } from "@/lib/shop-page-edit";
import { quoteTypesFromTheme } from "@/lib/quote-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

type Row = { id: number; slug: string; name: string | null; theme_json: unknown };

async function guard(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return { res: json(enforced.body, enforced.status) };
  if (!user) return { res: json({ ok: false, error: "UNAUTHENTICATED" }, 401) };
  if (String(user.role || "").toLowerCase() !== "admin") {
    return { res: json({ ok: false, error: "FORBIDDEN", message: "Admins only." }, 403) };
  }
  const tenantId = Number(user.tenant_id);
  if (!Number.isFinite(tenantId) || tenantId <= 0) return { res: json({ ok: false, error: "NO_SHOP" }, 400) };
  return { tenantId };
}

function view(row: Row) {
  const th = row.theme_json && typeof row.theme_json === "object" ? (row.theme_json as Record<string, unknown>) : {};
  return {
    slug: row.slug,
    name: row.name || "",
    brandName: typeof th.brandName === "string" && th.brandName.trim() ? th.brandName.trim() : row.name || row.slug,
    page_url: shopPageUrl(row.slug),
    // the Displays tile shows on its own for shops that quote Boxes and Displays
    quote_displays: quoteTypesFromTheme(th).includes("boxes_only"),
    values: shopPageValues(th),
  };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ("res" in g) return g.res;
  const row = await one<Row>(`SELECT id, slug, name, theme_json FROM public.tenants WHERE id = $1`, [g.tenantId]);
  if (!row) return json({ ok: false, error: "NOT_FOUND" }, 404);
  return json({ ok: true, ...view(row) });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => null)) as { changes?: unknown } | null;
  const cleaned = cleanShopPagePatch(body?.changes);
  if (!cleaned.ok) {
    return json({ ok: false, error: "INVALID", message: "Some fields need a fix.", errors: cleaned.errors }, 400);
  }
  if (Object.keys(cleaned.patch).length === 0) {
    const row = await one<Row>(`SELECT id, slug, name, theme_json FROM public.tenants WHERE id = $1`, [g.tenantId]);
    if (!row) return json({ ok: false, error: "NOT_FOUND" }, 404);
    return json({ ok: true, ...view(row), ignored: cleaned.ignored, changed: [] });
  }
  const row = await one<Row>(
    `UPDATE public.tenants
        SET theme_json = COALESCE(theme_json, '{}'::jsonb) || $2::jsonb
      WHERE id = $1
      RETURNING id, slug, name, theme_json`,
    [g.tenantId, JSON.stringify(cleaned.patch)],
  );
  if (!row) return json({ ok: false, error: "NOT_FOUND" }, 404);
  return json({ ok: true, ...view(row), ignored: cleaned.ignored, changed: Object.keys(cleaned.patch) });
}
