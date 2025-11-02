// app/api/admin/templates/route.ts
// Admin preview + logs for reply templates (B1–B4)
// - Picks template via inboxEmail/inboxId/channelId/default
// - Renders with vars ({{firstName}}, {{company}}, {{quoteLink}}, etc.)
// - Per-inbox signatures via env SIGNATURES_JSON (auto-append if not referenced)
// - Optional brand wrapper (REPLY_BRAND_WRAPPER or ?wrap=1)
// - Text fallback preview (derived from inner HTML)
// - Rolling logs of recent previews

import { NextRequest, NextResponse } from "next/server";
import { pickTemplateWithKey } from "@/app/lib/templates";
import { makeKv } from "@/app/lib/kv";
import { renderTemplate, htmlToText } from "@/app/lib/tpl";
import { shouldWrap, wrapHtml } from "@/app/lib/layout";
import { pickSignature } from "@/app/lib/signature";

export const dynamic = "force-dynamic";

type TemplateRow = { subject?: string; html?: string };
type TemplateTable = Record<string, TemplateRow>;
type Vars = Record<string, string>;

function parseJsonEnv(name: string): TemplateTable | null {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TemplateTable;
  } catch {
    return null;
  }
}

async function appendLog(entry: any) {
  try {
    const kv = makeKv();
    const key = "alexio:tpl:recent";
    const raw = (await kv.get(key)) || "[]";
    let list: any[] = [];
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
    list.unshift(entry);
    if (list.length > 50) list = list.slice(0, 50); // cap at 50
    await kv.set(key, JSON.stringify(list), 7 * 24 * 60 * 60); // 7 days TTL
  } catch {
    // best effort logging only
  }
}

export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);
    const action = (u.searchParams.get("action") || "").toLowerCase();

    // Return rolling logs
    if (action === "logs") {
      const kv = makeKv();
      const raw = (await kv.get("alexio:tpl:recent")) || "[]";
      let list: any[] = [];
      try {
        list = JSON.parse(raw);
      } catch {
        list = [];
      }
      return NextResponse.json({ ok: true, logs: list });
    }

    // Preview params
    const inboxEmail = u.searchParams.get("inboxEmail") || undefined;
    const inboxId = u.searchParams.get("inboxId") || undefined;
    const channelId = u.searchParams.get("channelId") || undefined;

    // Optional vars to render into subject/html
    const vars: Vars = {
      firstName: u.searchParams.get("firstName") || "",
      lastName: u.searchParams.get("lastName") || "",
      name: u.searchParams.get("name") || "",
      company: u.searchParams.get("company") || "",
      displayName: u.searchParams.get("displayName") || "",
      quoteLink: u.searchParams.get("quoteLink") || "",
      quoteId: u.searchParams.get("quoteId") || "",
      signatureHtml: "", // filled below
    };

    // Choose template key and row
    const picked = pickTemplateWithKey({ inboxEmail, inboxId, channelId });

    // Per-inbox signature selection (env SIGNATURES_JSON)
    const sig = pickSignature({ inboxEmail, inboxId, channelId });
    vars.signatureHtml = sig.html;

    // Render subject and inner HTML
    const subject =
      renderTemplate(picked.template.subject, vars) ||
      picked.template.subject ||
      "(none)";

    const baseInner =
      renderTemplate(picked.template.html, vars) ||
      picked.template.html ||
      "";

    // Auto-append signature if template does not reference {{signatureHtml}}
    const innerHtml = /\{\{\s*signatureHtml\s*\}\}/.test(baseInner)
      ? baseInner
      : `${baseInner}
         <div style="margin-top:16px; border-top:1px solid #e5e7eb; padding-top:12px;">
           ${sig.html}
         </div>`;

    // Wrapper toggle: ?wrap=1 forces on, otherwise follow REPLY_BRAND_WRAPPER
    const wrapParam = (u.searchParams.get("wrap") || "").toLowerCase();
    const wrapOn = wrapParam === "1" || (wrapParam === "" && shouldWrap());
    const html = wrapOn ? wrapHtml(innerHtml) : innerHtml;

    // Text fallback from INNER html (not the wrapper)
    const textPreview = htmlToText(innerHtml).slice(0, 280);

    // Optional: include raw env table
    const show = u.searchParams.get("show");
    const table =
      show === "raw" ? parseJsonEnv("REPLY_TEMPLATES_JSON") ?? "(not set)" : undefined;

    const payload = {
      ok: true,
      context: { inboxEmail, inboxId, channelId },
      matchedKey: picked.key,
      subject,
      wrapped: wrapOn,
      htmlPreview: String(html).slice(0, 280),
      textPreview,
      table,
    };

    // Log preview (rolling)
    await appendLog({
      ts: new Date().toISOString(),
      context: { inboxEmail, inboxId, channelId },
      matchedKey: picked.key,
      subject,
      wrapped: wrapOn,
      htmlPreview: String(html).slice(0, 140),
      textPreview: textPreview.slice(0, 140),
    });

    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // Validate a proposed table and render with provided context/vars (no env mutation).
  try {
    const body = await req.json();
    const table = body?.table as TemplateTable;
    const context = (body?.context || {}) as {
      inboxEmail?: string;
      inboxId?: string | number;
      channelId?: string | number;
    };
    const vars = (body?.vars || {}) as Vars;
    const wrap = !!body?.wrap;

    if (!table || typeof table !== "object") {
      return NextResponse.json(
        { ok: false, error: "table must be an object" },
        { status: 400 }
      );
    }
    for (const [k, v] of Object.entries(table)) {
      if (!v || typeof v !== "object") {
        return NextResponse.json(
          { ok: false, error: `key "${k}" must be object` },
          { status: 400 }
        );
      }
      if (v.subject != null && typeof v.subject !== "string") {
        return NextResponse.json(
          { ok: false, error: `key "${k}".subject must be string` },
          { status: 400 }
        );
      }
      if (v.html != null && typeof v.html !== "string") {
        return NextResponse.json(
          { ok: false, error: `key "${k}".html must be string` },
          { status: 400 }
        );
      }
    }

    // Determine match using provided context
    const tryKeys: string[] = [];
    if (context.inboxEmail)
      tryKeys.push(`inbox:${String(context.inboxEmail).toLowerCase()}`);
    if (context.inboxId != null)
      tryKeys.push(`inboxId:${String(context.inboxId)}`);
    if (context.channelId != null)
      tryKeys.push(`channelId:${String(context.channelId)}`);
    tryKeys.push("default");

    let matchedKey = "(fallback)";
    let row: TemplateRow | null = table["default"] || null;
    for (const k of tryKeys) {
      if (table[k]) {
        matchedKey = k;
        row = table[k];
        break;
      }
    }

    // Allow caller to provide a signature override via vars.signatureHtml (optional)
    const baseInner =
      renderTemplate(row?.html, vars) || row?.html || "";

    // If the body does not include {{signatureHtml}}, auto-append if provided in vars
    const needsAppend = !/\{\{\s*signatureHtml\s*\}\}/.test(baseInner);
    const innerHtml =
      needsAppend && vars.signatureHtml
        ? `${baseInner}
           <div style="margin-top:16px; border-top:1px solid #e5e7eb; padding-top:12px;">
             ${vars.signatureHtml}
           </div>`
        : baseInner;

    const subj = renderTemplate(row?.subject, vars) || row?.subject || "(none)";
    const outHtml = wrap ? wrapHtml(innerHtml) : innerHtml;
    const outText = htmlToText(innerHtml).slice(0, 280);

    return NextResponse.json({
      ok: true,
      matchedKey,
      subject: subj,
      wrapped: wrap,
      htmlPreview: outHtml.slice(0, 280),
      textPreview: outText,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
