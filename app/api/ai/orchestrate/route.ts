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

function J(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
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
  return v ? String(v).trim().toLowerCase() : "";
}
function q(req: NextRequest, key: string) {
  return new URL(req.url).searchParams.get(key);
}
function isDryRun(req: NextRequest) {
  return q(req, "dryRun") === "1" || req.headers.get("x-dry-run") === "1";
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
  const sig = pickSignature({}); // your signature helper expects a ctx; empty is fine
  const inner = `
    <p>${intro}</p>
    <ul style="padding-left:18px;margin:12px 0;">${list}</ul>
    <p>${outro}</p>
    <hr style="border:none;border-top:1px solid #eef1f6;margin:16px 0;" />
    ${sig?.html ?? ""}
  `;
  // IMPORTANT: your repo’s wrapHtml is (subject, html[, opts])
  return wrapHtml(subject, inner);
}

async function tryDeepLookup(origin: string, inReplyTo?: string) {
  if (!inReplyTo) return null;
  try {
    const res = await fetch(`${origin}/api/hubspot/lookup?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ messageId: inReplyTo }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && data.email) {
      return { email: data.email as string, via: (data.via as string) || "lookup" };
    }
  } catch { /* ignore */ }
  return null;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const origin = originFrom(req);
  const dryRun = isDryRun(req);
  const kv = makeKv();

  try {
    // 1) Parse body
    let body: OrchestrateIn;
    try {
      body = (await req.json()) as OrchestrateIn;
    } catch (e: any) {
      return J({ ok: false, error: "bad_json", detail: String(e) }, { status: 400 });
    }

    // 2) Inputs
    const userText = (body.text || "").trim();
    let toEmail = normalizeEmail(body.toEmail);
    const inReplyTo = (body.inReplyTo || "").trim() || undefined;
    const subjectOverride = body.subject;

    if (!userText && !subjectOverride) {
      return J({ ok: false, error: "missing_text_or_subject" }, { status: 400 });
    }

    // 3) Lookup email if needed
    let lookupInfo: { email?: string; via?: string } | null = null;
    if (!toEmail && inReplyTo) {
      lookupInfo = await tryDeepLookup(origin, inReplyTo);
      if (lookupInfo?.email) toEmail = normalizeEmail(lookupInfo.email);
    }
    if (!toEmail) {
      return J(
        {
          ok: false,
          error: "no_toEmail",
          detail:
            "Provide 'toEmail' or an 'inReplyTo' that resolves to a known conversation.",
        },
        { status: 400 }
      );
    }

    // 4) Plan + HTML
    let subject = subjectOverride || planReply(userText).subject;
    let html = "";
    try {
      const plan = planReply(userText);
      subject = subjectOverride || plan.subject;
      html = buildHtmlTwoArg(subject, plan.lead, plan.bullets, plan.outro);
    } catch (e: any) {
      return J(
        { ok: false, error: "template_build_failed", detail: String(e) },
        { status: 500 }
      );
    }

    // 5) Send or dry-run
    let graph: any = null;
    let sentOk = false;
    if (dryRun) {
      graph = { status: 200, dryRun: true };
      sentOk = true;
    } else {
      try {
        const r = await fetch(`${origin}/api/msgraph/send?t=${Date.now()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ to: toEmail, subject, html, inReplyTo }),
        });
        graph = await r.json().catch(() => ({}));
        sentOk = !!graph?.ok || r.ok;
      } catch (e: any) {
        return J(
          { ok: false, error: "msgraph_send_failed", detail: String(e) },
          { status: 502 }
        );
      }
    }

    // 6) Log (non-fatal)
    try {
      await (kv as any).lpush(
        "alexio:orchestrate:recent",
        JSON.stringify({
          at: new Date().toISOString(),
          ms: Date.now() - started,
          dryRun,
          toEmail,
          inReplyTo: short(inReplyTo),
          subject: short(subject, 120),
          ok: sentOk,
          graphStatus: graph?.status ?? null,
          preview: short(userText, 240),
        })
      );
      await (kv as any).ltrim("alexio:orchestrate:recent", 0, 50);
    } catch {
      /* ignore log errors */
    }

    return J({
      ok: sentOk,
      dryRun,
      toEmail,
      subject,
      ms: Date.now() - started,
      method: "msgraph/send",
      graph,
    });
  } catch (e: any) {
    // Catch absolutely everything
    return J(
      {
        ok: false,
        error: "unhandled",
        detail: String(e?.message || e),
        step: "top_level",
      },
      { status: 500 }
    );
  }
}
