// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { wrapHtml } from "@/app/lib/layout";
import { pickSignature } from "@/app/lib/signature";

export const dynamic = "force-dynamic";

type OrchestrateIn = {
  text?: string;
  toEmail?: string;
  inReplyTo?: string;
  subject?: string;
};

type SendOut = {
  ok: boolean;
  sent?: any;
  graph?: any;
  reason?: string;
  debug?: any;
};

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function badRequest(msg: string) {
  return json({ ok: false, error: msg }, { status: 400 });
}

function originFrom(req: NextRequest) {
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
  }
}

function normalizeEmail(v?: string | null) {
  if (!v) return "";
  return String(v).trim().toLowerCase();
}

function short(s: any, max = 600) {
  const v = typeof s === "string" ? s : JSON.stringify(s);
  return v.length > max ? v.slice(0, max) + "…" : v;
}

function planReply(userText: string) {
  const t = userText.toLowerCase();

  const wantsQuote =
    /quote|price|pricing|estimate|how much|cost/.test(t) ||
    /\b\d+\s*(pcs|pieces|qty|quantity)\b/.test(t);

  const mentionsDims =
    /\b\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?\b/.test(t) ||
    /\b(l|length)\s*\d+/.test(t);

  if (!wantsQuote || !mentionsDims) {
    return {
      subject: "Got it — quick specs check",
      lead:
        "I can put a quote together quickly. Could you confirm a few details so we size this correctly?",
      bullets: [
        "Inner cavity **Length × Width × Height** (inches)?",
        "How many **cavities** per insert?",
        "Target **quantity**?",
        "Preferred **foam** (e.g., PE 1.7 pcf) or “recommend best”?",
      ],
      outro:
        "If you have a drawing or sketch, you can attach it to your reply. I’ll run the numbers and send a price.",
    };
  }

  return {
    subject: "Thanks — running numbers now",
    lead:
      "Thanks for the specs. I’ll run a quick waste-adjusted price. If anything below is missing, reply with the details:",
    bullets: [
      "Confirm **Length × Width × Height** (inches)",
      "Number of **cavities**",
      "Production **quantity**",
      "Foam type (e.g., PE 1.7 pcf) — or ask for a recommendation",
    ],
    outro:
      "I’ll send a draft quote next. If you need alternate quantities or materials, just say so.",
  };
}

function buildHtmlTwoArg(subject: string, intro: string, bullets: string[], outro: string) {
  const list = bullets.map(b => `<li style="margin:6px 0;">${b}</li>`).join("");
  const sig = pickSignature({}); // pass empty ctx to satisfy arg
  const inner = `
    <p>${intro}</p>
    <ul style="padding-left:18px; margin:12px 0;">${list}</ul>
    <p>${outro}</p>
    <hr style="border:none;border-top:1px solid #eef1f6;margin:16px 0;" />
    ${sig?.html ?? ""}
  `;
  // IMPORTANT: use the 2-arg variant implemented in your repo
  return wrapHtml(subject, inner);
}

async function tryDeepLookup(origin: string, inReplyTo?: string) {
  if (!inReplyTo) return null;
  try {
    const res = await fetch(`${origin}/api/hubspot/lookup?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: inReplyTo }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.ok && data.email) {
      return { email: data.email as string, via: (data.via as string) || "lookup" };
    }
  } catch { /* ignore */ }
  return null;
}

export async function POST(req: NextRequest) {
  const kv = makeKv();
  const started = Date.now();
  const origin = originFrom(req);

  let body: OrchestrateIn | null = null;
  try {
    body = (await req.json()) as OrchestrateIn;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const userText = (body?.text || "").trim();
  const inReplyTo = body?.inReplyTo?.trim();
  let toEmail = normalizeEmail(body?.toEmail);
  const subjectOverride = body?.subject;

  if (!userText && !subjectOverride) {
    return badRequest("Missing 'text' (customer message).");
  }

  let lookupInfo: { email?: string; via?: string } | null = null;
  if (!toEmail && inReplyTo) {
    lookupInfo = await tryDeepLookup(origin, inReplyTo);
    if (lookupInfo?.email) toEmail = normalizeEmail(lookupInfo.email);
  }

  if (!toEmail) {
    await (kv as any).lpush(
      "alexio:orchestrate:recent",
      JSON.stringify({
        at: new Date().toISOString(),
        reason: "no_toEmail",
        inReplyTo: short(inReplyTo),
        text: short(userText, 240),
      })
    );
    return json(
      {
        ok: false,
        reason:
          "No 'toEmail' available (and lookup did not resolve one). Provide 'toEmail' or 'inReplyTo' linked to a known thread.",
      },
      { status: 400 }
    );
  }

  const plan = planReply(userText);
  const subject = subjectOverride || plan.subject;

  let html: string;
  try {
    html = buildHtmlTwoArg(subject, plan.lead, plan.bullets, plan.outro);
  } catch (e: any) {
    return json(
      { ok: false, error: "template_build_failed", detail: String(e) },
      { status: 500 }
    );
  }

  let sendResp: SendOut;
  try {
    const r = await fetch(`${origin}/api/msgraph/send?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ to: toEmail, subject, html, inReplyTo }),
    });
    const j = await r.json();
    sendResp = j as SendOut;
  } catch (err: any) {
    sendResp = { ok: false, reason: "send_failed", debug: String(err) };
  }

  await (kv as any).lpush(
    "alexio:orchestrate:recent",
    JSON.stringify({
      at: new Date().toISOString(),
      ms: Date.now() - started,
      toEmail,
      inReplyTo: short(inReplyTo),
      ok: !!sendResp?.ok,
      graph: sendResp?.graph?.status ?? null,
      subject: short(subject, 120),
      preview: short(userText, 240),
    })
  );
  await (kv as any).ltrim("alexio:orchestrate:recent", 0, 50);

  return json({
    ok: !!sendResp?.ok,
    toEmail,
    subject,
    ms: Date.now() - started,
    method: "msgraph/send",
    graph: sendResp?.graph ?? null,
    debug: {
      via: lookupInfo?.via || (body?.toEmail ? "direct" : "unknown"),
      usedLookup: !!lookupInfo?.email,
    },
  });
}
