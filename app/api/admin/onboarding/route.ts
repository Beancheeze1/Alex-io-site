// app/api/admin/onboarding/route.ts
//
// Step 36A: the shop's "Get started" checklist (app/lib/onboarding.ts).
//   GET                                   -> { ok, checklist, slug }
//   POST { step, done: true | false }     -> tick / untick a step by hand
//                                            (only steps that allow it)
//   POST { starter: "foam" | "corrugated" } -> fill the empty rates with
//                                            the starter numbers (never
//                                            overwrites); { ok, set }
// Admins of the shop. The platform owner can pass ?tenant_id= / tenant_id.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadChecklist, loadStarterCorrugated, loadStarterFoam, markStep } from "@/app/lib/onboarding";
import { canMark, isStepKey } from "@/app/lib/onboarding-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function admin(req: NextRequest, tenantRaw: unknown) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: json({ ok: false, error: "unauthorized", message: "Login required." }, 401) };
  if (!isRoleAllowed(user, ["admin"])) return { res: json({ ok: false, error: "forbidden", message: "Admins only." }, 403) };
  const asked = Number(tenantRaw);
  const tenantId = isPlatformOwner(user) && Number.isInteger(asked) && asked > 0 ? asked : Number(user.tenant_id);
  return { user, tenantId };
}

export async function GET(req: NextRequest) {
  try {
    const a = await admin(req, req.nextUrl.searchParams.get("tenant_id"));
    if ("res" in a) return a.res;
    const r = await loadChecklist(a.tenantId);
    if (!r) return json({ ok: false, error: "not_found", message: "Shop not found." }, 404);
    return json({ ok: true, ...r, tenant_id: a.tenantId });
  } catch (e) {
    console.error("[admin/onboarding] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the checklist." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const a = await admin(req, b?.tenant_id);
    if ("res" in a) return a.res;
    const who = String((a.user as { name?: string | null }).name || a.user.email || "admin");

    if (b?.starter === "foam") return json({ ok: true, set: await loadStarterFoam(a.tenantId) });
    if (b?.starter === "corrugated") return json({ ok: true, set: await loadStarterCorrugated(a.tenantId) });
    if (b?.starter !== undefined) return json({ ok: false, error: "invalid_starter", message: "starter must be foam or corrugated." }, 400);

    if (!isStepKey(b?.step)) return json({ ok: false, error: "invalid_step", message: "Unknown checklist step." }, 400);
    if (!canMark(b.step)) return json({ ok: false, error: "not_manual", message: "This step ticks itself when it's done." }, 400);
    await markStep(a.tenantId, b.step, b.done !== false, who);
    const r = await loadChecklist(a.tenantId);
    return json({ ok: true, ...(r || {}) });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") return json({ ok: false, error: "not_migrated", message: "The checklist isn't set up yet (migration 047)." }, 503);
    console.error("[admin/onboarding] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't save. Please try again." }, 500);
  }
}
