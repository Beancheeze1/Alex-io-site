import { NextRequest, NextResponse } from "next/server";
import { tokenStore } from "@/lib/tokenStore";
import { handleApiError } from "@/lib/api-error";
import logger from "@/lib/logger";
import { adminOnly } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminOnly(async (req: NextRequest) => {
  try {
    const keys = tokenStore.listKeys();
    const rows = keys.map((k) => {
      const rec = tokenStore.get(/^\d+$/.test(k) ? Number(k) : undefined);
      return {
        key: k,
        hubId: rec?.hubId ?? null,
        hasToken: !!rec?.access_token,
        expiresIn: rec?.expires_in ?? null,
        obtainedAt: rec?.obtained_at ?? null,
      };
    });

    const def = tokenStore.get();

    logger.info("✅ Peek token store requested", { keyCount: keys.length });

    return NextResponse.json({
      ok: true,
      portals: keys,
      default: {
        hasToken: !!def?.access_token,
        hubId: def?.hubId ?? null,
        expiresIn: def?.expires_in ?? null,
        obtainedAt: def?.obtained_at ?? null,
      },
      entries: rows,
    });
  } catch (e) {
    return handleApiError(e, "auth/peek");
  }
});