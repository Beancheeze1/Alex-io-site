// app/api/admin/config/route.ts
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

  const replyEnabled = String(process.env.REPLY_ENABLED ?? "").toLowerCase() === "true";
  const internalSendUrlSet = Boolean(process.env.INTERNAL_SEND_URL);
  return NextResponse.json({ ok: true, cfg: { replyEnabled, internalSendUrlSet } });
}
