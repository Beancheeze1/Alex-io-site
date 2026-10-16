// app/api/admin/users/invite/route.ts
//
// Step 36A: invite a user by email (no password typed by the admin).
//   POST { email, name, role, sales_slug?, tenant_id? (platform owner) }
//     -> creates the user with an unusable password and emails them a
//        7-day set-password link from their shop: { ok, user, email }
//   POST { user_id, resend: true } -> a fresh link (older ones stop working)
// Admins of the shop; the shop's seat limit applies to new users.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { checkSeatLimit } from "@/lib/plan";
import { sendAccessEmail, unusablePasswordHash } from "@/lib/user-invites";
import { cleanInvite } from "@/app/lib/onboarding-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin"])) return json({ ok: false, error: "forbidden", message: "Admins only." }, 403);
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const asked = Number(b?.tenant_id);
    const tenantId = isPlatformOwner(user) && Number.isInteger(asked) && asked > 0 ? asked : Number(user.tenant_id);
    const by = String((user as { name?: string | null }).name || user.email || "Your admin");

    if (b?.resend === true) {
      const id = Number(b.user_id);
      const target = Number.isInteger(id) && id > 0
        ? await one<{ id: number }>(`SELECT id FROM public."users" WHERE id = $1 AND tenant_id = $2`, [id, tenantId])
        : null;
      if (!target) return json({ ok: false, error: "not_found", message: "User not found." }, 404);
      const sent = await sendAccessEmail({ userId: Number(target.id), tenantId, kind: "invite", by });
      return json({ ok: sent.status === "sent", email: sent.status, message: sent.status === "sent" ? "Invite sent." : "The invite email didn't go out." }, sent.status === "sent" ? 200 : 502);
    }

    const c = cleanInvite(b);
    if (!c.ok) return json({ ok: false, error: "invalid_input", field: c.field, message: c.message }, 400);

    const seats = await checkSeatLimit(tenantId);
    if (!seats.allowed) {
      return json({ ok: false, error: "SEAT_LIMIT_REACHED", message: `Your ${seats.plan} plan allows up to ${seats.limit} users.` }, 402);
    }

    let created: { id: number; email: string; name: string; role: string } | null = null;
    try {
      created = await one<{ id: number; email: string; name: string; role: string }>(
        `INSERT INTO public."users" (email, name, role, password_hash, sales_slug, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, name, role`,
        [c.value.email, c.value.name, c.value.role, await unusablePasswordHash(), c.value.sales_slug, tenantId],
      );
    } catch (e) {
      if ((e as { code?: string } | null)?.code === "23505") {
        const msg = String((e as { message?: string }).message || "").toLowerCase();
        return json(
          { ok: false, error: "duplicate", message: msg.includes("slug") ? "That sales slug is taken." : "A user with that email already exists." },
          409,
        );
      }
      throw e;
    }
    if (!created) return json({ ok: false, error: "server_error", message: "Couldn't create the user." }, 500);
    const sent = await sendAccessEmail({ userId: Number(created.id), tenantId, kind: "invite", by });
    return json({ ok: true, user: created, email: sent.status });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") return json({ ok: false, error: "not_migrated", message: "Invites aren't set up yet (migration 047)." }, 503);
    console.error("[admin/users/invite] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't send the invite." }, 500);
  }
}
