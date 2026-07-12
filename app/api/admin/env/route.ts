import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isPlatformOwner } from "@/lib/admin-auth";
import { getCurrentUserFromRequest } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const user = await getCurrentUserFromRequest(req);
  if (!isPlatformOwner(user)) {
    return NextResponse.json({ ok: false, error: "forbidden", message: "Platform owner access required." }, { status: 403 });
  }

  const names = ["MS_TENANT_ID","MS_CLIENT_ID","MS_CLIENT_SECRET","MS_MAILBOX_FROM"];
  const present = Object.fromEntries(names.map(n => [n, Boolean(process.env[n] && String(process.env[n]).trim().length>0)]));
  return NextResponse.json({ ok: true, present });
}
