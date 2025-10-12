import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET() {
  try {
    const ping = await redis.ping();
    const key = `hc:${Date.now()}`;
    await redis.set(key, "ok", { ex: 60 });
    const val = await redis.get<string>(key);
    return NextResponse.json({ ok: true, ping, roundTrip: val === "ok" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

