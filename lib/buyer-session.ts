// lib/buyer-session.ts
//
// Step 34A: the buyer portal's sign-in (server only, Node crypto).
//   - Sign-in links: newLinkToken() makes a random token; only its SHA-256
//     (hashLinkToken) is stored in buyer_login_links. Used once, 30 minutes.
//   - Session: cookie alexio_buyer = base64url(JSON {t: tenant id, e: email,
//     x: expiry ms}) + "." + HMAC-SHA256(AUTH_SECRET, "buyer-session:v1:" + payload).
//     30 days, httpOnly, per host (the shop's own address).
// signSession / verifySession take the secret so scripts/test-portal.ts can
// test them without AUTH_SECRET.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { SESSION_DAYS, normEmail } from "@/app/lib/portal-core";

export const BUYER_COOKIE = "alexio_buyer";

export type BuyerSession = { tenantId: number; email: string; expires: number };

function secret(): string {
  const s = process.env.AUTH_SECRET || "";
  if (s.length < 16) throw new Error("AUTH_SECRET is not set; buyer sessions can't be signed.");
  return s;
}

export function newLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(`buyer-link:v1:${String(token || "")}`).digest("hex");
}

function mac(payload: string, key: string): string {
  return createHmac("sha256", key).update(`buyer-session:v1:${payload}`).digest("base64url");
}

export function signSession(s: { tenantId: number; email: string; expires: number }, key: string): string {
  const payload = Buffer.from(JSON.stringify({ t: s.tenantId, e: normEmail(s.email), x: s.expires })).toString("base64url");
  return `${payload}.${mac(payload, key)}`;
}

export function verifySession(value: string | null | undefined, key: string, now: number): BuyerSession | null {
  const v = String(value || "");
  const dot = v.indexOf(".");
  if (dot <= 0 || v.length > 2000) return null;
  const payload = v.slice(0, dot);
  const sig = v.slice(dot + 1);
  const want = mac(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { t?: unknown; e?: unknown; x?: unknown };
    const tenantId = Number(j.t);
    const email = normEmail(j.e);
    const expires = Number(j.x);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !email || !Number.isFinite(expires) || expires <= now) return null;
    return { tenantId, email, expires };
  } catch {
    return null;
  }
}

export function readBuyerSession(req: NextRequest): BuyerSession | null {
  try {
    return verifySession(req.cookies.get(BUYER_COOKIE)?.value, secret(), Date.now());
  } catch {
    return null;
  }
}

export function setBuyerSession(res: NextResponse, tenantId: number, email: string): NextResponse {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  res.cookies.set(BUYER_COOKIE, signSession({ tenantId, email, expires }, secret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}

export function clearBuyerSession(res: NextResponse): NextResponse {
  res.cookies.set(BUYER_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
