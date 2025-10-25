import { NextResponse } from "next/server";
// Use the ONE that matches your kv export (see note below):
// import getRedisClient from "@/lib/kv";                 // if default export
// import { getRedisClient } from "@/lib/kv";            // if named function
// import { kv as getRedisClient } from "@/lib/kv";      // if it exports `kv` instance

export const dynamic = "force-dynamic";

async function getKV() {
  // pick one line that matches your lib:
  // return await getRedisClient();  // if it’s a function you call
  // return getRedisClient;          // if it’s already an instance (named `kv`)
  // If you’re not sure, open lib/kv.ts and check exports.
  // TEMP fallback to avoid blocking:
  // @ts-ignore
  return typeof getRedisClient === "function" ? await getRedisClient() : getRedisClient;
}

export async function GET() {
  try {
    const kv = await getKV();
    const hasAccess  = !!(await kv.get("hubspot:access_token"));
    const hasRefresh = !!(await kv.get("hubspot:refresh_token"));

    return NextResponse.json({
      ok: true,
      authorized: hasAccess && hasRefresh,
      tokens: { access: hasAccess, refresh: hasRefresh },
      source: "hubspot",
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
