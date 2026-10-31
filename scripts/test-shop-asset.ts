// scripts/test-shop-asset.ts
//
// Step 46: uploaded logo / banner checks (lib/shop-asset.ts).
// Run: npm run test:shop-asset

import { checkShopAsset, publicOrigin, shopAssetUrl, sniffImage, SHOP_ASSET_FIELD } from "../lib/shop-asset";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const gif = new TextEncoder().encode("GIF89a....");

check("png by its bytes", sniffImage(png) === "image/png");
check("jpg by its bytes", sniffImage(jpg) === "image/jpeg");
check("webp by its bytes", sniffImage(webp) === "image/webp");
check("svg refused", sniffImage(svg) === null && !checkShopAsset("logo", svg).ok);
check("gif refused", !checkShopAsset("banner", gif).ok);
check("empty refused", !checkShopAsset("logo", new Uint8Array()).ok);

const big = new Uint8Array(1024 * 1024 + 1);
big.set(png);
const r1 = checkShopAsset("logo", big);
check("logo over 1 MB refused with the size", !r1.ok && /1 MB/.test(r1.message), r1);
check("the same file is fine as a banner (6 MB)", checkShopAsset("banner", big).ok);
const huge = new Uint8Array(6 * 1024 * 1024 + 1);
huge.set(jpg);
check("banner over 6 MB refused", !checkShopAsset("banner", huge).ok);
const ok = checkShopAsset("logo", png);
check("a small png logo passes with its type", ok.ok && ok.type === "image/png", ok);

check("fields: logo -> logoUrl, banner -> heroImageUrl", SHOP_ASSET_FIELD.logo === "logoUrl" && SHOP_ASSET_FIELD.banner === "heroImageUrl");
check("url", shopAssetUrl("https://ashtonne.api.alex-io.com/", 42) === "https://ashtonne.api.alex-io.com/api/public/shop-asset/42");

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
check("origin from the proxy headers", publicOrigin(h({ "x-forwarded-host": "ashtonne.api.alex-io.com", "x-forwarded-proto": "https", host: "localhost:10000" })) === "https://ashtonne.api.alex-io.com");
check("origin: always https in production", publicOrigin(h({ host: "api.alex-io.com", "x-forwarded-proto": "http" })) === "https://api.alex-io.com");
check("origin: http only for localhost", publicOrigin(h({ host: "localhost:3000", "x-forwarded-proto": "http" })) === "http://localhost:3000");
check("origin: a junk host falls back", publicOrigin(h({ host: "evil.com/<x>" })) === "https://api.alex-io.com");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
