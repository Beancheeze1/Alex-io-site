// app/api/auth/login/route.ts
//
// Email + password login.
// POST JSON: { email, password }
// On success:
//   - Sets HTTP-only session cookie
//   - Returns { ok: true, user: { id, email, name, role, tenant_id } }

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { one } from "@/lib/db";
import { resolveTenantFromHost } from "@/lib/tenant";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  type CurrentUser,
} from "@/lib/auth";
import { rateLimitCheck } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UserRow = {
  id: number;
  email: string;
  name: string;
  role: string;
  tenant_id: number;
  password_hash: string;
};

function bad(body: any, status = 400) {
  return NextResponse.json({ ok: false, ...body }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as any;

  const emailRaw = body?.email;
  const passwordRaw = body?.password;

  if (
    typeof emailRaw !== "string" ||
    emailRaw.trim().length === 0 ||
    typeof passwordRaw !== "string" ||
    passwordRaw.length === 0
  ) {
    return bad(
      {
        error: "invalid_credentials",
        message: "Invalid email or password.",
      },
      401,
    );
  }

  const email = emailRaw.trim().toLowerCase();
  const password = passwordRaw;

  // Rate limit: 20 attempts/min per IP, 10 attempts/5min per email
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const [rlIp, rlEmail] = await Promise.all([
    rateLimitCheck(`login:ip:${ip}`, 20, 60),
    rateLimitCheck(`login:email:${email}`, 10, 300),
  ]);
  if (!rlIp.allowed || !rlEmail.allowed) {
    return bad({ error: "rate_limited", message: "Too many attempts. Try again later." }, 429);
  }

  try {
    const host = req.headers.get("host");
    const tenant = await resolveTenantFromHost(host);

    if (!tenant) {
      return bad(
        { error: "tenant_not_found", message: "Tenant not found for this host." },
        404,
      );
    }

    const user = await one<UserRow>(
      `
      select id, email, name, role, tenant_id, password_hash
      from users
      where email = $1
        and tenant_id = $2
      `,
      [email, tenant.id],
    );

    if (!user || !user.password_hash) {
      return bad(
        {
          error: "invalid_credentials",
          message: "Invalid email or password.",
        },
        401,
      );
    }

    // Enforce tenant_id at login boundary (fail closed).
    if (typeof user.tenant_id !== "number") {
      return bad(
        {
          error: "tenant_required",
          message: "User is missing tenant assignment.",
        },
        403,
      );
    }

    const okPwd = await bcrypt.compare(password, user.password_hash);
    if (!okPwd) {
      return bad(
        {
          error: "invalid_credentials",
          message: "Invalid email or password.",
        },
        401,
      );
    }

    const safeUser: CurrentUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenant_id: user.tenant_id,
    };

    const token = createSessionToken(safeUser);

    const res = NextResponse.json(
      {
        ok: true,
        user: safeUser,
      },
      { status: 200 },
    );

res.cookies.set({
  name: SESSION_COOKIE_NAME,
  value: token,
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/",
  domain: ".alex-io.com", // <-- critical for A2: cookie must be set at parent domain to be sent to all subdomains
  maxAge: SESSION_MAX_AGE_SEC,
});

    return res;
  } catch (err) {
    console.error("Error in /api/auth/login:", err);
    return bad(
      {
        error: "server_error",
        message: "Unexpected error. Check server logs.",
      },
      500,
    );
  }
}
