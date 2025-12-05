// app/api/auth/login/route.ts
//
// Email + password login.
// POST JSON: { email, password }
// On success:
//   - Sets HTTP-only session cookie
//   - Returns { ok: true, user: { id, email, name, role } }

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { one } from "@/lib/db";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  type CurrentUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UserRow = {
  id: number;
  email: string;
  name: string;
  role: string;
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

  const email = emailRaw.trim();
  const password = passwordRaw;

  try {
    const user = await one<UserRow>(
      `
      select id, email, name, role, password_hash
      from users
      where email = $1
      `,
      [email],
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

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
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
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    });

    return res;
  } catch (err) {
    console.error("Error in /api/auth/login:", err);
    return bad(
      {
        error: "server_error",
        message: "There was a problem logging in. Please try again.",
      },
      500,
    );
  }
}

export function GET() {
  // Optional: You can expand this later if you want a GET to check basic health.
  return NextResponse.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405 },
  );
}
