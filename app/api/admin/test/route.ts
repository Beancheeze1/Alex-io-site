import { NextResponse } from "next/server";
import { kvPing } from "@/lib/kv";
import { tokenStore } from "@/lib/tokenStore";
import { hsGetOwners } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const adminKey = process.env.ADMIN_KEY || "";
  const hdr = new Headers(req.headers).get("x-admin-key") || "";

  if (!adminKey || hdr !== adminKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const kv = await kvPing();
  const keys = tokenStore.listKeys();
  let owners: any = null, ownersOk = false;

  try {
    owners = await hsGetOwners(undefined, { limit: 1 });
    ownersOk = true;
  } catch {}

  return NextResponse.json({
    ok: true,
    kv,
    tokens: keys,
    hubspotOwnersOk: ownersOk,
  });
}
