// lib/shop-asset.ts
//
// Step 46: checks for a logo or banner photo a shop uploads on Shop settings
// → Shop page. The file type is read from the file's own first bytes (not its
// name): PNG, JPEG or WebP only. SVG is refused: it can carry scripts, and
// these files are served from our own address. Pure (tested in
// scripts/test-shop-asset.ts).

export type ShopAssetKind = "logo" | "banner";
export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export const SHOP_ASSET_MAX_BYTES: Record<ShopAssetKind, number> = {
  logo: 1 * 1024 * 1024,
  banner: 6 * 1024 * 1024,
};

/** The theme field each kind fills. */
export const SHOP_ASSET_FIELD: Record<ShopAssetKind, "logoUrl" | "heroImageUrl"> = {
  logo: "logoUrl",
  banner: "heroImageUrl",
};

export function isShopAssetKind(v: unknown): v is ShopAssetKind {
  return v === "logo" || v === "banner";
}

/** The image type from the file's first bytes, or null. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export type AssetCheck = { ok: true; type: ImageType } | { ok: false; message: string };

/** Is this file a usable logo / banner? */
export function checkShopAsset(kind: ShopAssetKind, b: Uint8Array): AssetCheck {
  const what = kind === "logo" ? "The logo" : "The banner photo";
  if (!b.length) return { ok: false, message: `${what} file is empty.` };
  const max = SHOP_ASSET_MAX_BYTES[kind];
  if (b.length > max) {
    return { ok: false, message: `${what} can be up to ${Math.round(max / 1024 / 1024)} MB (this file is ${(b.length / 1024 / 1024).toFixed(1)} MB).` };
  }
  const type = sniffImage(b);
  if (!type) return { ok: false, message: `${what} must be a PNG, JPG or WebP image.` };
  return { ok: true, type };
}

/** The public address of an uploaded file. */
export function shopAssetUrl(origin: string, id: number | string): string {
  return `${origin.replace(/\/+$/, "")}/api/public/shop-asset/${id}`;
}

/** The site's public origin from the request headers (behind Render's proxy). */
export function publicOrigin(h: { get(name: string): string | null }): string {
  const host = (h.get("x-forwarded-host") || h.get("host") || "api.alex-io.com").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0].trim();
  const safeHost = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? host : "api.alex-io.com";
  return `${proto === "http" && /^localhost(:\d+)?$/.test(safeHost) ? "http" : "https"}://${safeHost}`;
}
