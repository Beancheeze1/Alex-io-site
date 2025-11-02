// app/api/admin/canary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";

export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; info?: any };

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function todayKey(prefix: string) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${prefix}:${y}${m}${dd}`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;
    const kv = makeKv();

    const force = url.searchParams.get("force") === "1";
    const dryRun = url.searchParams.get("dryRun") === "1";

    const checks: Check[] = [];

    // 1) Env presence
    let fromEmail = "";
    try {
      requireEnv("MS_TENANT_ID");
      requireEnv("MS_CLIENT_ID");
      requireEnv("MS_CLIENT_SECRET");
      fromEmail = requireEnv("MS_MAILBOX_FROM");
      checks.push({ name: "env", ok: true });
    } catch (e: any) {
      checks.push({ name: "env", ok: false, info: e?.message });
      return NextResponse.json({ ok: false, checks }, { status: 500 });
    }

    // 2) Once/day (unless ?force=1)
    const dayKey = todayKey("alexio:canary");
    const already = await kv.get(dayKey);
    if (already && !force && !dryRun) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        checks,
        info: "already sent today",
      });
    }

    // 3) Try a live send (or dryRun inspect only)
    const subject = `Canary OK — Alex-IO (${new Date().toISOString()})`;
    const html = `<p>This is the Alex-IO canary. If you see this, Microsoft Graph send is working.</p>`;
    const payload = { to: process.env.CANARY_TO || fromEmail, subject, html };

    const sendUrl = `${SELF}/api/msgraph/send`;
    const res = await postJson(sendUrl, payload);
    const txt = await res.text().catch(() => "");

    if (!res.ok) {
      checks.push({ name: "graph", ok: false, info: txt.slice(0, 1000) });
      return NextResponse.json({ ok: false, checks }, { status: 502 });
    }

    checks.push({ name: "graph", ok: true });

    // 4) Mark success for the day (36h TTL so timezones are safe)
    if (!dryRun) {
      await kv.set(dayKey, "1", 36 * 60 * 60);
    }

    return NextResponse.json({
      ok: true,
      sent: !dryRun,
      checks,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
