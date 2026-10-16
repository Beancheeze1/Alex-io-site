// app/api/admin/cleanup/test-quotes/route.ts
//
// Step 36B: delete QA test quotes by number (app/lib/test-cleanup.ts).
//   POST { quote_nos }                        -> dry run: { ok, preview }
//   POST { quote_nos, apply: true, confirm }  -> deletes, all or nothing:
//                                                { ok, deleted }
// Platform owner only. Locked / released quotes can be deleted here (the
// owner lists them by number and types the confirm phrase). Quotes with
// commission / expense records are refused.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { deleteTestQuotes, previewTestQuotes } from "@/app/lib/test-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin"]) || !isPlatformOwner(user)) {
      return json({ ok: false, error: "forbidden", message: "Platform owner only." }, 403);
    }
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const list = b?.quote_nos;

    if (b?.apply !== true) {
      const p = await previewTestQuotes(list);
      return p.ok ? json({ ok: true, preview: p.preview }) : json({ ok: false, error: "invalid_input", message: p.message }, 400);
    }

    const r = await deleteTestQuotes(list, b.confirm, String(user.email || user.id));
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message, preview: r.preview }, r.status);
    return json({ ok: true, deleted: r.deleted, quote_nos: r.quote_nos });
  } catch (e) {
    console.error("[admin/cleanup/test-quotes] failed:", e);
    return json({ ok: false, error: "server_error", message: e instanceof Error ? e.message : "Cleanup failed. Nothing was deleted." }, 500);
  }
}
