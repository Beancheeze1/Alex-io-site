// app/api/cron/reminders/route.ts
//
// Step 29B: the hourly reminder run (app/lib/reminders.ts).
//   POST /api/cron/reminders
//     Authorization: Bearer <CRON_SECRET>   GitHub Actions, hourly
//     or the platform owner's login         manual checks
//   Query (platform owner only, except dry):
//     dry=1          work out what would be sent; send and record nothing
//     digest_now=1   ignore the shops' digest hour
//     tenant=<slug>  one shop only
//     force=1        run again within the same hour
//   -> { ok, dry, at, shops: [{ shop, expiring, followup, digest, errors }] }
// A real run claims the current UTC hour first (shop_emails), so a repeated
// call in the same hour does nothing.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { claimShopEmail, finishShopEmail, runReminders } from "@/app/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cronSecretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (secret.length < 16 || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const viaCron = cronSecretOk(req);
    let owner = false;
    if (!viaCron) {
      const user = await getCurrentUserFromRequest(req).catch(() => null);
      owner = isPlatformOwner(user);
    }
    if (!viaCron && !owner) {
      console.warn("[cron/reminders] refused", { ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown" });
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const sp = req.nextUrl.searchParams;
    const dry = sp.get("dry") === "1";
    const digestNow = owner && sp.get("digest_now") === "1";
    const tenantSlug = owner ? sp.get("tenant") : null;
    const force = owner && sp.get("force") === "1";

    const hourKey = new Date().toISOString().slice(0, 13);
    if (!dry && !force) {
      const claim = await claimShopEmail(0, "reminders_run", hourKey);
      if (claim === "taken") return json({ ok: true, skipped: "already ran this hour", hour: hourKey });
    }

    const summary = await runReminders({ dry, digestNow, tenantSlug });

    if (!dry && !force) {
      const n = (k: "expiring" | "followup") => summary.shops.reduce((t, s) => t + s[k].length, 0);
      await finishShopEmail(0, "reminders_run", hourKey, {
        status: "sent",
        detail: `shops ${summary.shops.length}, expiring ${n("expiring")}, follow-up ${n("followup")}, digests ${
          summary.shops.filter((s) => s.digest.startsWith("sent")).length
        }`,
      });
    }
    console.log("[cron/reminders] done", JSON.stringify({ dry, shops: summary.shops.length }));
    return json(summary);
  } catch (e) {
    console.error("[cron/reminders] failed:", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
