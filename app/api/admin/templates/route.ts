// app/api/admin/templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pickTemplateWithKey } from "@/app/lib/templates";
import { makeKv } from "@/app/lib/kv";
import { renderTemplate } from "@/app/lib/tpl";

export const dynamic = "force-dynamic";

type TemplateTable = Record<string, { subject?: string; html?: string }>;
type Vars = Record<string, string>;

function parseJsonEnv(name: string): TemplateTable | null {
  const raw = process.env[name];
  if (!raw) return null;
  try { return JSON.parse(raw) as TemplateTable; } catch { return null; }
}

async function appendLog(entry: any) {
  try {
    const kv = makeKv();
    const key = "alexio:tpl:recent";
    const raw = (await kv.get(key)) || "[]";
    let list: any[] = [];
    try { list = JSON.parse(raw); } catch { list = []; }
    list.unshift(entry);
    if (list.length > 50) list = list.slice(0, 50); // cap
    await kv.set(key, JSON.stringify(list), 7 * 24 * 60 * 60); // 7 days TTL
  } catch {
    // best-effort; ignore logging errors
  }
}

export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);
    const action = u.searchParams.get("action") || ""; // "logs" or ""

    if (action === "logs") {
      const kv = makeKv();
      const raw = (await kv.get("alexio:tpl:recent")) || "[]";
      let list: any[] = [];
      try { list = JSON.parse(raw); } catch { list = []; }
      return NextResponse.json({ ok: true, logs: list });
    }

    // Preview / render
    const inboxEmail = u.searchParams.get("inboxEmail") || undefined;
    const inboxId = u.searchParams.get("inboxId") || undefined;
    const channelId = u.searchParams.get("channelId") || undefined;

    // Optional customer vars to render
    const vars: Vars = {
      firstName: u.searchParams.get("firstName") || "",
      lastName: u.searchParams.get("lastName") || "",
      name: u.searchParams.get("name") || "",
      company: u.searchParams.get("company") || "",
      displayName: u.searchParams.get("displayName") || "",
      quoteLink: u.searchParams.get("quoteLink") || "",
      quoteId: u.searchParams.get("quoteId") || "",
    };

    // Choose + render
    const picked = pickTemplateWithKey({ inboxEmail, inboxId, channelId });
    const subject = renderTemplate(picked.template.subject, vars) || picked.template.subject || "(none)";
    const html = renderTemplate(picked.template.html, vars) || picked.template.html || "";

    // Optional: ?show=raw
    const show = u.searchParams.get("show");
    const table = show === "raw" ? (parseJsonEnv("REPLY_TEMPLATES_JSON") ?? "(not set)") : undefined;

    const payload = {
      ok: true,
      context: { inboxEmail, inboxId, channelId },
      matchedKey: picked.key,
      subject,
      htmlPreview: html.slice(0, 280),
      table,
    };

    // Append to rolling log
    await appendLog({
      ts: new Date().toISOString(),
      context: { inboxEmail, inboxId, channelId },
      matchedKey: picked.key,
      subject,
      htmlPreview: html.slice(0, 140),
    });

    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Validates a proposed table and renders with optional vars (no env mutation).
  try {
    const body = await req.json();
    const table = body?.table as TemplateTable;
    const context = (body?.context || {}) as { inboxEmail?: string; inboxId?: string | number; channelId?: string | number };
    const vars = (body?.vars || {}) as Vars;

    if (!table || typeof table !== "object") {
      return NextResponse.json({ ok: false, error: "table must be an object" }, { status: 400 });
    }
    for (const [k, v] of Object.entries(table)) {
      if (!v || typeof v !== "object") return NextResponse.json({ ok: false, error: `key "${k}" must be object` }, { status: 400 });
      if (v.subject != null && typeof v.subject !== "string") return NextResponse.json({ ok: false, error: `key "${k}".subject must be string` }, { status: 400 });
      if (v.html != null && typeof v.html !== "string") return NextResponse.json({ ok: false, error: `key "${k}".html must be string` }, { status: 400 });
    }

    // Re-implement match here using the provided table
    const tryKeys: string[] = [];
    if (context.inboxEmail) tryKeys.push(`inbox:${String(context.inboxEmail).toLowerCase()}`);
    if (context.inboxId != null) tryKeys.push(`inboxId:${String(context.inboxId)}`);
    if (context.channelId != null) tryKeys.push(`channelId:${String(context.channelId)}`);
    tryKeys.push("default");

    let matchedKey = "(fallback)";
    let row = table["default"] || null;
    for (const k of tryKeys) {
      if (table[k]) { matchedKey = k; row = table[k]; break; }
    }
    const subj = renderTemplate(row?.subject, vars) || row?.subject || "(none)";
    const html = renderTemplate(row?.html, vars) || row?.html || "";

    return NextResponse.json({
      ok: true,
      matchedKey,
      subject: subj,
      htmlPreview: html.slice(0, 280),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
