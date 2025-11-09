// app/api/ai/orchestrate/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Always target production base — never localhost
const BASE =
  (process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    "https://api.alex-io.com").replace(/\/+$/, "");

/** minimal guard */
function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** tiny on-box “AI” (template) so replies aren’t echoes */
function composeAiReply(userText: string): string {
  const t = (userText || "").trim();
  // short, safe default
  if (!t) {
    return "Thanks for reaching out — we received your message and will respond with details shortly.";
  }
  // include a short acknowledgement but never echo the whole message back verbatim
  const preview = t.length > 140 ? `${t.slice(0, 140)}…` : t;
  return `Thanks for your message. Based on your note (“${preview}”), we’ll draft a quote and follow up with next steps. If we missed anything (dimensions, quantity, timeline), reply here and we’ll adjust.`;
}

async function postJson<T>(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body ?? {}),
  });
  const status = r.status;
  const txt = await r.text();
  try {
    const json = JSON.parse(txt) as T;
    return { ok: r.ok, status, json };
  } catch {
    return { ok: r.ok, status, text: txt };
  }
}

export async function POST(req: Request) {
  console.log("\n////////////////////////////////////////////");
  console.log("[orchestrate] entry");

  const payload: any = await req.json().catch(() => ({}));

  const toEmail = String(payload?.toEmail || "");
  const rawSubject = String(payload?.subject || "");
  const rawText = String(payload?.text || "");
  const dryRun = Boolean(payload?.dryRun);

  if (!isEmail(toEmail)) {
    console.log("[orchestrate] invalid toEmail", toEmail);
    return NextResponse.json(
      { ok: false, error: "invalid_toEmail" },
      { status: 200 }
    );
  }

  // Compose the human-friendly reply
  const subject = rawSubject || "Re: your message";
  const text = composeAiReply(rawText);

  // Delegate to your working msgraph sender route
  const sendUrl = `${BASE}/api/msgraph/send?t=${Date.now()}`;
  const sendBody = {
    mode: dryRun ? "dryrun" : "live",
    toEmail,
    subject,
    text,
    inReplyTo: payload?.inReplyTo ?? null,
    dryRun, // msgraph route already supports this
  };

  console.log("[orchestrate] msgraph/send →", sendUrl, "{ to:", `'${toEmail}'`, ", dryRun:", dryRun, "}");

  const sendRes = await postJson<{ ok: boolean; result?: string }>(sendUrl, sendBody);

  const out = {
    ok: Boolean(sendRes.ok),
    mode: dryRun ? "dryrun" : "live",
    to: toEmail,
    subject,
    result: (sendRes as any).json?.result || (sendRes as any).text || "",
  };

  console.log("[orchestrate] result", out);

  return NextResponse.json(out, { status: 200 });
}
