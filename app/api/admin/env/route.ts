import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const names = ["MS_TENANT_ID","MS_CLIENT_ID","MS_CLIENT_SECRET","MS_MAILBOX_FROM"];
  const present = Object.fromEntries(names.map(n => [n, Boolean(process.env[n] && String(process.env[n]).trim().length>0)]));
  return NextResponse.json({ ok: true, present });
}
