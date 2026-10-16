// lib/user-invites.ts
//
// Step 36A: set-password links for invited users ("invite", 7 days) and
// forgotten passwords ("reset", 1 hour). Server only (Node crypto, bcrypt).
//   - createAccessLink(): a random token; only its SHA-256 is stored in
//     user_invites (migration 047). Older unused links of the same user and
//     kind stop working.
//   - sendAccessEmail(): emails the link from the user's shop (its name,
//     colors, its own address so the login that follows is on that host)
//   - checkPasswordLink(): is the link still usable (read only, Step 36B)
//   - redeemPasswordLink(): checks the token, sets the password, marks it used
// A user created by invite gets an unusable random password until then.

import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { one, withTxn } from "@/lib/db";
import { sendHtmlEmail } from "@/lib/email/send-html";
import { shopSender } from "@/app/lib/quote-mail";
import { INVITE_DAYS, RESET_MINUTES, accessEmail, passwordProblem } from "@/app/lib/onboarding-core";

export type AccessKind = "invite" | "reset";

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(`user-access:v1:${String(token || "")}`).digest("hex");
}

export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("base64url"), 10);
}

export async function createAccessLink(args: { userId: number; tenantId: number; kind: AccessKind; by?: string | null }): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const minutes = args.kind === "invite" ? INVITE_DAYS * 24 * 60 : RESET_MINUTES;
  await withTxn(async (tx) => {
    await tx.query(
      `UPDATE public.user_invites SET used_at = now()
        WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`,
      [args.userId, args.kind],
    );
    await tx.query(
      `INSERT INTO public.user_invites (user_id, tenant_id, kind, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 minute'), $6)`,
      [args.userId, args.tenantId, args.kind, hashAccessToken(token), minutes, args.by ? String(args.by).slice(0, 120) : null],
    );
  });
  return token;
}

/** Sends the invite / reset email. Returns "sent" or the send error. */
export async function sendAccessEmail(args: {
  userId: number;
  tenantId: number;
  kind: AccessKind;
  by?: string | null;
}): Promise<{ status: "sent" | "failed"; detail: string | null }> {
  const user = await one<{ email: string; name: string | null }>(`SELECT email, name FROM public."users" WHERE id = $1 AND tenant_id = $2`, [
    args.userId,
    args.tenantId,
  ]);
  if (!user) return { status: "failed", detail: "user not found" };
  const token = await createAccessLink(args);
  const sender = await shopSender(args.tenantId);
  const link = `${sender.baseUrl}/set-password?t=${encodeURIComponent(token)}`;
  const { subject, html } = accessEmail({
    kind: args.kind,
    brand: sender.brand,
    name: user.name,
    link,
    invitedBy: args.kind === "invite" ? args.by ?? null : null,
    primaryColor: sender.primaryColor,
    onPrimary: sender.onPrimary,
    logoUrl: sender.logoUrl,
  });
  const r = await sendHtmlEmail({ to: user.email, subject, html, fromName: sender.brand, replyTo: sender.replyTo, replyToName: sender.brand });
  if (!r.ok) console.error("[user-invites] send failed", { userId: args.userId, kind: args.kind, err: r.error });
  return r.ok ? { status: "sent", detail: null } : { status: "failed", detail: r.error };
}

export type UseResult = { ok: true; email: string; kind: AccessKind } | { ok: false; status: number; error: string; message: string };

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;
const EXPIRED = "This link has expired or was already used. Ask for a new one.";

/**
 * Step 36B: is this link still usable? Read only: it does NOT use the link up,
 * so the set-password page can say "expired" before showing the form.
 */
export async function checkPasswordLink(token: string): Promise<{ valid: boolean; kind: AccessKind | null }> {
  if (!TOKEN_SHAPE.test(String(token || ""))) return { valid: false, kind: null };
  const row = await one<{ kind: AccessKind }>(
    `SELECT kind FROM public.user_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashAccessToken(token)],
  );
  return { valid: !!row, kind: row ? row.kind : null };
}

/** Sets the password from a link (one use). The link is checked before the password (Step 36B). */
export async function redeemPasswordLink(token: string, password: string): Promise<UseResult> {
  if (!TOKEN_SHAPE.test(String(token || ""))) {
    return { ok: false, status: 400, error: "invalid_link", message: "This link isn't valid. Ask for a new one." };
  }
  if (!(await checkPasswordLink(token)).valid) return { ok: false, status: 410, error: "expired_link", message: EXPIRED };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, status: 400, error: "weak_password", message: problem };
  const hash = await bcrypt.hash(password, 10);
  return withTxn(async (tx) => {
    const used = await tx.query<{ user_id: number; kind: AccessKind }>(
      `UPDATE public.user_invites SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id, kind`,
      [hashAccessToken(token)],
    );
    const row = used.rows[0];
    if (!row) return { ok: false, status: 410, error: "expired_link", message: EXPIRED } as UseResult;
    const u = await tx.query<{ email: string }>(`UPDATE public."users" SET password_hash = $2 WHERE id = $1 RETURNING email`, [row.user_id, hash]);
    if (!u.rows[0]) return { ok: false, status: 410, error: "expired_link", message: "This account no longer exists." } as UseResult;
    return { ok: true, email: u.rows[0].email, kind: row.kind } as UseResult;
  });
}
