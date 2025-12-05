// lib/auth.ts
//
// Simple session helper for email+password auth.
// - Uses HMAC-SHA256 signed payload (no external JWT library).
// - Stores a small JSON payload in a cookie: base64(payload).signature
// - SECRET: AUTH_SECRET env var (must be set in Render).
//
// This file is Node runtime only (uses `crypto`).

import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { one } from "@/lib/db";

export const SESSION_COOKIE_NAME = "alexio_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 8; // 8 hours

type SessionPayload = {
  userId: number;
  email: string;
  name: string;
  role: string;
  iat: number; // issued at (seconds)
  exp: number; // expires at (seconds)
};

export type CurrentUser = {
  id: number;
  email: string;
  name: string;
  role: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getAuthSecret(): string {
  return requireEnv("AUTH_SECRET");
}

function signPayload(base64Payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(base64Payload).digest("hex");
}

export function createSessionToken(user: CurrentUser): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: nowSec,
    exp: nowSec + SESSION_MAX_AGE_SEC,
  };

  const json = JSON.stringify(payload);
  const base64Payload = Buffer.from(json, "utf8").toString("base64url");
  const secret = getAuthSecret();
  const signature = signPayload(base64Payload, secret);

  return `${base64Payload}.${signature}`;
}

export function verifySessionToken(
  token: string | null | undefined,
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [base64Payload, signature] = parts;
  const secret = getAuthSecret();
  const expected = signPayload(base64Payload, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: SessionPayload;
  try {
    const json = Buffer.from(base64Payload, "base64url").toString("utf8");
    payload = JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload.userId !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) return null;

  return payload;
}

// Constant-time compare to avoid timing attacks on the signature.
function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function getUserById(userId: number): Promise<CurrentUser | null> {
  const row = await one<{
    id: number;
    email: string;
    name: string;
    role: string;
  }>(
    `
    select id, email, name, role
    from users
    where id = $1
    `,
    [userId],
  );

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

/**
 * For API routes / Node handlers:
 *   const user = await getCurrentUserFromRequest(req);
 */
export async function getCurrentUserFromRequest(
  req: NextRequest,
): Promise<CurrentUser | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}

/**
 * For server components / layouts:
 *   const user = await getCurrentUserFromCookies();
 *
 * Note: In Next 16+, cookies() is async.
 */
export async function getCurrentUserFromCookies(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value || null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}
