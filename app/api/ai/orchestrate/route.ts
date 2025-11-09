// app/api/ai/orchestrate/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateIn = {
  mode: "ai";
  toEmail?: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
};

const BASE = "https://api.alex-io.com"; // per project rule
const REPLY_ENABLED = String(process.env.REPLY_ENABLED ?? "").toLowerCase() === "true";

async function graphSend(body: any) {
  const url = `${BASE}/api/msgraph/send?t=${Math.random()}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let json: any = undefined;
  try { json = JSON.parse(txt); } catch {}
  return { ok: r.ok, status: r.status, body: json ?? txt, url };
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as OrchestrateIn;

    if (!REPLY_ENABLED) {
      return NextResponse.json({ ok: true, dryRun: true, reason: "reply_disabled" }, { status: 200 });
    }

    const toEmail = String(payload.toEmail ?? "").trim();
    const subject = String(payload.subject ?? "").trim();
    const text = String(payload.text ?? "").trim();
    const dryRun = Boolean(payload.dryRun);

    if (!toEmail) {
      const res = { ok: true, dryRun, send_ok: false, reason: "missing_toEmail" };
      console.log("[orchestrate] missing_toEmail", res);
      return NextResponse.json(res, { status: 200 });
    }

    // (AI content generation would go here; for now we pass through `text`.)
    const body = {
      mode: dryRun ? "dryrun" : "live",
      toEmail,
      subject: subject || "Re:",
      text: text || "Thanks for your message — we’ll follow up shortly.",
      inReplyTo: payload.inReplyTo ?? null,
      dryRun,
    };

    const send = await graphSend(body);
    console.log("[orchestrate] msgraph/send { to: '%s', dryRun:%s, status:%d }", toEmail, dryRun, send.status);

    return NextResponse.json({ ok: send.ok, result: send.body, to: toEmail, subject: body.subject, mode: body.mode }, { status: 200 });
  } catch (err: any) {
    console.error("[orchestrate] exception", err?.message ?? err);
    return NextResponse.json({ ok: false, error: "orchestrate_exception", detail: err?.message ?? String(err) }, { status: 200 });
  }
}
