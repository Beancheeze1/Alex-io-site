// lib/auth.ts
//
// Simple session helper for email+password auth.
// - Uses HMAC-SHA256 signed payload (no external JWT library).
// - Stores a small JSON payload in a cookie: base64(payload).signature
// - SECRET: AUTH_SECRET env var (must be set in Render).
//
// IMPORTANT (Multi-tenant hard gate):
// - Session payload includes tenant_id.
// - We also resolve the request tenant from Host (A2 pattern) and REQUIRE:
//     user.tenant_id === resolvedTenant.id
//   If mismatch => treat as logged out (returns null).
//
// This file is Node runtime only (uses `crypto`).

import crypto from "crypto";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { one } from "@/lib/db";
import { resolveTenantFromHost } from "@/lib/tenant";

export const SESSION_COOKIE_NAME = "alexio_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 8; // 8 hours

type SessionPayload = {
  userId: number;
  email: string;
  name: string;
  role: string;
  tenant_id: number;
  iat: number; // issued at (seconds)
  exp: number; // expires at (seconds)
};

export type CurrentUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  tenant_id: number;
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
    tenant_id: user.tenant_id,
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
    tenant_id: number | null;
  }>(
    `
    select id, email, name, role, tenant_id
    from users
    where id = $1
    `,
    [userId],
  );

  if (!row) return null;

  // Enforce tenant_id at auth boundary (fail closed).
  if (row.tenant_id === null || typeof row.tenant_id !== "number") return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tenant_id: row.tenant_id,
  };
}

// --- Cookie extraction fallback (Path A, additive) ---
// NextRequest.cookies should work, but in some deployments/routes it can appear empty.
// This fallback reads the raw Cookie header and extracts SESSION_COOKIE_NAME.
function getCookieFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  // Very small, safe parser: "a=b; c=d" -> find exact "name="
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (s.startsWith(name + "=")) {
      const v = s.slice(name.length + 1);
      // Cookie values are generally not quoted; keep as-is.
      return v || null;
    }
  }
  return null;
}

async function isTenantMatch(host: string | null, user: CurrentUser): Promise<boolean> {
  const t = await resolveTenantFromHost(host);
  if (!t) return false;
  return t.id === user.tenant_id;
}

/**
 * For API routes / Node handlers:
 *   const user = await getCurrentUserFromRequest(req);
 */
export async function getCurrentUserFromRequest(
  req: NextRequest,
): Promise<CurrentUser | null> {
  const tokenFromCookies = req.cookies.get(SESSION_COOKIE_NAME)?.value || null;

  const token =
    tokenFromCookies ||
    getCookieFromHeader(req.headers.get("cookie"), SESSION_COOKIE_NAME);

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await getUserById(payload.userId);
  if (!user) return null;

  // HARD GATE: request host tenant must match user tenant_id
  const host = req.headers.get("host");
  if (!(await isTenantMatch(host, user))) return null;

  return user;
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

  const user = await getUserById(payload.userId);
  if (!user) return null;

  // HARD GATE: current host tenant must match user tenant_id
  // Server Components can read host from headers()
  let host: string | null = null;
  try {
    const h = await headers();
    host = h.get("host");
  } catch {
    host = null;
  }

  if (!(await isTenantMatch(host, user))) return null;

  return user;
}

// --- RBAC helpers (Path A, additive) ---

export type Role = "viewer" | "sales" | "cs" | "admin";

function toRole(roleRaw: string | null | undefined): Role | null {
  const r = (roleRaw || "").trim().toLowerCase();
  if (r === "viewer" || r === "sales" || r === "cs" || r === "admin") return r;
  return null; // fail closed
}

export function isRoleAllowed(
  user: CurrentUser | null | undefined,
  allowed: Role[],
): boolean {
  if (!user) return false;
  const r = toRole(user.role);
  if (!r) return false;
  return allowed.includes(r);
}