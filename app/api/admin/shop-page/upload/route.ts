// app/api/admin/shop-page/upload/route.ts
//
// Step 46: a shop admin uploads their logo or banner photo (Shop settings →
// Shop page). multipart/form-data: kind ("logo" | "banner"), file.
// Checks the file (lib/shop-asset.ts: PNG / JPG / WebP by its own bytes;
// logo up to 1 MB, banner up to 6 MB), stores it, points the shop's logoUrl /
// heroImageUrl at it (one jsonb merge, nothing else in the theme changes),
// then removes the shop's older file of that kind.
// -> { ok, kind, url, field, values } (values = the Shop page fields, as GET)
// Admins of the shop only. 503 until migration 052 has run.

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { SHOP_ASSET_FIELD, checkShopAsset, isShopAssetKind, publicOrigin, shopAssetUrl } from "@/lib/shop-asset";
import { shopPageValues } from "@/lib/shop-page-edit";
import { shopAssetsReady } from "@/app/lib/shop-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);
  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  if (String(user.role || "").toLowerCase() !== "admin") {
    return json({ ok: false, error: "FORBIDDEN", message: "Admins only." }, 403);
  }
  const tenantId = Number(user.tenant_id);
  if (!Number.isFinite(tenantId) || tenantId <= 0) return json({ ok: false, error: "NO_SHOP" }, 400);

  if (!(await shopAssetsReady())) {
    return json(
      { ok: false, error: "NOT_READY", message: "File uploads aren't switched on yet. Paste a link to the image for now." },
      503,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "BAD_FORM", message: "Pick a file to upload." }, 400);
  }
  const kind = form.get("kind");
  if (!isShopAssetKind(kind)) return json({ ok: false, error: "BAD_KIND", message: "Upload a logo or a banner photo." }, 400);
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ ok: false, error: "NO_FILE", message: "Pick a file to upload." }, 400);

  const buf = Buffer.from(await file.arrayBuffer());
  const check = checkShopAsset(kind, new Uint8Array(buf));
  if (!check.ok) return json({ ok: false, error: "BAD_FILE", message: check.message }, 400);

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ins = await one<{ id: string | number }>(
    `INSERT INTO public.tenant_assets (tenant_id, kind, content_type, bytes, sha256, data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [tenantId, kind, check.type, buf.length, sha256, buf, Number(user.id) || null],
  );
  if (!ins) return json({ ok: false, error: "SAVE_FAILED", message: "Couldn't save the file." }, 500);

  const url = shopAssetUrl(publicOrigin(req.headers), ins.id);
  const field = SHOP_ASSET_FIELD[kind];
  const row = await one<{ theme_json: unknown }>(
    `UPDATE public.tenants
        SET theme_json = COALESCE(theme_json, '{}'::jsonb) || jsonb_build_object($2::text, $3::text)
      WHERE id = $1
      RETURNING theme_json`,
    [tenantId, field, url],
  );
  if (!row) return json({ ok: false, error: "NOT_FOUND" }, 404);

  // keep only the current file of this kind (non-fatal)
  try {
    await q(`DELETE FROM public.tenant_assets WHERE tenant_id = $1 AND kind = $2 AND id <> $3`, [tenantId, kind, ins.id]);
  } catch (e) {
    console.warn("[shop-page/upload] old file cleanup failed", { tenantId, kind, err: String(e) });
  }

  return json({ ok: true, kind, field, url, values: shopPageValues(row.theme_json) });
}
