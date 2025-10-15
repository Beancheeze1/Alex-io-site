import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

async function ls(p) {
  try {
    const items = await fs.readdir(p, { withFileTypes: true });
    return items.map(d => ({ name: d.name, type: d.isDirectory() ? "dir" : "file" }));
  } catch (e) {
    return [{ name: "<err:" + String(e) + ">" }];
  }
}

export async function GET() {
  const cwd = process.cwd();
  const top = await ls(".");
  const nextDir = await ls(".next").catch(() => []);
  const nextServer = await ls(".next/server").catch(() => []);
  const nextApp = await ls(".next/server/app").catch(() => []);
  const webhookDir = await ls(".next/server/app/api/hubspot/webhook").catch(() => []);
  const pagesApi = await ls(".next/server/pages/api").catch(() => []);
  return NextResponse.json({
    ok: true,
    probe: "/api/_diag/fs",
    cwd,
    top,
    nextDir,
    nextServer,
    nextAppSample: nextApp.slice(0, 40),
    webhookDir,
    pagesApiSample: pagesApi.slice(0, 40),
  }, { status: 200 });
}

