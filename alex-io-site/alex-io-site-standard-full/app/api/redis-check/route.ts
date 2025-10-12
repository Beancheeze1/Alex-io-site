import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.https://honest-lark-23183.upstash.io,
  token: process.env.AVqPAAIncDIwMGRhNjdlMjFmZTk0NDgwOTY1ODcyODM0NDBmOGY2NXAyMjMxODM,
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

