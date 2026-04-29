//lib/rate-limit.ts
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { env } from "./env";
import logger from "./logger";

const redis = Redis.fromEnv();

const WINDOW_MS = 60 * 1000; // 1 minute

export async function rateLimit(
  req: Request,
  limit: number = 15,
  prefix: string = "ratelimit"
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const key = `${prefix}:${ip}`;

  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart - 1);
    pipeline.zadd(key, { score: now, member: `${now}` });
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(WINDOW_MS / 1000) + 10);

    const [, , count] = await pipeline.exec();

    const remaining = Math.max(0, limit - Number(count || 0));

    return {
      success: remaining > 0,
      limit,
      remaining,
      reset: windowStart + WINDOW_MS,
    };
  } catch (err) {
    logger.warn("Rate limit Redis error – allowing request", { ip, error: err });
    return { success: true, limit, remaining: limit, reset: now + WINDOW_MS };
  }
}

export function rateLimitResponse(reset: number) {
  return NextResponse.json(
    {
      ok: false,
      error: "Too many requests. Please slow down.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
        "X-RateLimit-Limit": "15",
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}