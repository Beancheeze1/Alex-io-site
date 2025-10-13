import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(p) {
  try {
    const s = await fs.readFile(p, "utf8");
    return JSON.parse(s);
  } catch (e) {
    return { _error: String(e) };
  }
}

export async function GET() {
  try {
    const base = ".next/server";
    const appPaths = await readJson(path.join(base, "app-paths-manifest.json"));
    const middleware = await readJson(path.join(base, "middleware-manifest.json"));
    const pages = await readJson(path.join(base, "pages-manifest.json")).catch(() => ({}));

    // Check for our webhook route in the app router manifest
    const appRoutes = Object.keys(appPaths || {});
    const hasWebhook = appRoutes.some(r => r.includes("/api/hubspot/webhook"));

    return NextResponse.json({
      ok: true,
      probe: "/api/_diag/router",
      hasWebhookInAppPaths: hasWebhook,
      exampleAppRoutesSample: appRoutes.slice(0, 30),
      appPathsKeysCount: appRoutes.length,
      middlewareKeys: Object.keys(middleware || {}).slice(0, 30),
      pagesKeys: Object.keys(pages || {}).slice(0, 30),
    }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

