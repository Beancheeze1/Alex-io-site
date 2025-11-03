// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

import { pickTemplateWithKey } from "@/app/lib/templates";
import { pickSignature } from "@/app/lib/signature";
import { makeKv } from "@/app/lib/kv";
import { renderTemplate, htmlToText } from "@/app/lib/tpl";
import { shouldWrap, wrapHtml } from "@/app/lib/layout";

export const dynamic = "force-dynamic";

function mustStr(v: string | undefined, fb = ""): string {
  return v ?? fb;
}

async function postJson<T = any>(path: string, body: unknown): Promise<T> {
  const url = new URL(
    path,
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com"
  ).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    next: { revalidate: 0 },
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err: any = new Error("postJson failed");
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json as T;
}

async function appendLog(entry: any) {
  try {
    const kv = makeKv?.();
    if (!kv) return;
    const key = "alexio:ai:orchestrate:recent";
    const raw = ((await kv.get(key)) as string) || "[]";
    let list: any[] = [];
    try {
      list = JSON.parse(raw);
    } catch {}
    list.unshift({ at: Date.now(), ...entry });
    list = list.slice(0, 50);
    // numeric TTL (seconds)
    await (kv as any).set(key, JSON.stringify(list), 60 * 60);
  } catch {}
}

type OrchestrateInput = {
  conversationId?: string;
  fromEmail?: string;
  text?: string;
  dryRun?: boolean;
};

function pickTemplateSafe(inboxEmail: string) {
  try {
    // @ts-expect-error object overload allowed
    return pickTemplateWithKey({ inboxEmail }) ?? pickTemplateWithKey(inboxEmail);
  } catch {
    try {
      // @ts-expect-error string overload allowed
      return pickTemplateWithKey(inboxEmail);
    } catch {
      return { subject: "[Alex-IO]", html: "{{body}}" };
    }
  }
}

function pickSignatureSafe(inboxEmail: string) {
  try {
    // @ts-expect-error object overload allowed
    return pickSignature({ inboxEmail }) ?? pickSignature(inboxEmail);
  } catch {
    try {
      // @ts-expect-error string overload allowed
      return pickSignature(inboxEmail);
    } catch {
      return { key: "(fallback)", html: "" };
    }
  }
}

export async function POST(req: NextRequest) {
  const started = Date.now();

  let body: OrchestrateInput = {};
  try {
    body = (await req.json()) as OrchestrateInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId = mustStr(body.conversationId, "");
  const fromEmail = mustStr(body.fromEmail, "").toLowerCase();
  const messageText = mustStr(body.text, "");
  const dryRun = Boolean(body.dryRun);

  if (!fromEmail) {
    return NextResponse.json({ ok: false, error: "fromEmail is required" }, { status: 400 });
  }

  const inboxEmail = String(process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();

  const templ = pickTemplateSafe(inboxEmail);
  const signature = pickSignatureSafe(inboxEmail);

  const subject = mustStr((templ as any)?.subject, "[Alex-IO]");
  const templateHtml = mustStr((templ as any)?.html, "{{body}}");

  const vars: Record<string, string> = {
    body: messageText,
    customerEmail: fromEmail,
    conversationId,
  };

  const renderedBody = renderTemplate(templateHtml, vars);
  const composedHtml = renderedBody + mustStr(signature?.html, "");

  // ✅ wrapHtml expects an object (Partial<WrapOpts>)
  const html = shouldWrap() ? wrapHtml({ subject, html: composedHtml }) : composedHtml;

  const text = htmlToText(html);

  const sendPayload = {
    to: fromEmail,
    subject: mustStr(subject, "[Alex-IO]"),
    html: mustStr(html, ""),
    text: mustStr(text, ""),
  };

  if (dryRun) {
    await appendLog({ kind: "dryRun", to: fromEmail, subject, ms: Date.now() - started });
    return NextResponse.json({
      ok: true,
      sent: false,
      dryRun: true,
      preview: { to: fromEmail, subject, html, text },
    });
  }

  try {
    const graph = await postJson<{ status: number; requestId?: string }>(
      "/api/msgraph/send",
      sendPayload
    );
    await appendLog({ kind: "send", to: fromEmail, subject, graph, ms: Date.now() - started });
    return NextResponse.json({ ok: true, sent: true, to: fromEmail, subject, graph });
  } catch (err: any) {
    await appendLog({
      kind: "error",
      to: fromEmail,
      subject,
      error: true,
      status: err?.status ?? 500,
      details: err?.payload ?? String(err),
      ms: Date.now() - started,
    });
    return NextResponse.json(
      { ok: false, error: "graph send failed", status: err?.status ?? 500, details: err?.payload ?? String(err) },
      { status: 502 }
    );
  }
}

export async function GET() {
  const inboxEmail = String(process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();
  const templ = pickTemplateSafe(inboxEmail);
  const signature = pickSignatureSafe(inboxEmail);

  return NextResponse.json({
    ok: true,
    inboxEmail,
    templateSubject: mustStr((templ as any)?.subject, "[Alex-IO]"),
    hasSignature: Boolean(signature?.html),
  });
}
