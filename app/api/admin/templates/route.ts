// app/api/admin/templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pickTemplate } from "@/app/lib/templates";

export const dynamic = "force-dynamic";

/** ---- Shared types ---- */
type TemplateRow = { subject?: string; html?: string };
type TemplateTable = Record<string, TemplateRow>;
type Ctx = { inboxEmail?: string; inboxId?: string | number; channelId?: string | number };

function parseJsonEnv(name: string): TemplateTable | null {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? (obj as TemplateTable) : null;
  } catch {
    return null;
  }
}

/** GET /api/admin/templates */
export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);
    const inboxEmail = u.searchParams.get("inboxEmail") ?? undefined;
    const inboxId = u.searchParams.get("inboxId") ?? undefined;
    const channelId = u.searchParams.get("channelId") ?? undefined;
    const show = u.searchParams.get("show");

    const chosen = pickTemplate({ inboxEmail, inboxId, channelId });

    const resp: any = {
      ok: true,
      context: { inboxEmail, inboxId, channelId },
      chosen: {
        subject: chosen.subject ?? "(none)",
        htmlPreview: (chosen.html ?? "").slice(0, 240),
      },
    };

    if (show === "raw") {
      resp.table = parseJsonEnv("REPLY_TEMPLATES_JSON") ?? "(not set)";
    }

    return NextResponse.json(resp);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}

/** POST /api/admin/templates
 * Body: { table: TemplateTable, context?: Ctx }
 * Validates a proposed REPLY_TEMPLATES_JSON and shows which row would match.
 */
export async function POST(req: NextRequest) {
  try {
    const { table, context } = (await req.json()) as {
      table: unknown;
      context?: Ctx;
    };

    // Strongly validate table shape
    if (!table || typeof table !== "object") {
      return NextResponse.json({ ok: false, error: "table must be a JSON object" }, { status: 400 });
    }
    const typedTable = table as TemplateTable;

    for (const [k, v] of Object.entries(typedTable)) {
      if (!v || typeof v !== "object") {
        return NextResponse.json({ ok: false, error: `key "${k}" must map to an object` }, { status: 400 });
      }
      if (v.subject != null && typeof v.subject !== "string") {
        return NextResponse.json({ ok: false, error: `key "${k}".subject must be a string` }, { status: 400 });
      }
      if (v.html != null && typeof v.html !== "string") {
        return NextResponse.json({ ok: false, error: `key "${k}".html must be a string` }, { status: 400 });
      }
    }

    const ctx: Ctx = context ?? {};
    const tryKeys: string[] = [];
    if (ctx.inboxEmail) tryKeys.push(`inbox:${String(ctx.inboxEmail).toLowerCase()}`);
    if (ctx.inboxId != null) tryKeys.push(`inboxId:${String(ctx.inboxId)}`);
    if (ctx.channelId != null) tryKeys.push(`channelId:${String(ctx.channelId)}`);
    tryKeys.push("default");

    let chosenKey: string | null = null;
    let chosenRow: TemplateRow | null = null;

    for (const k of tryKeys) {
      const row = typedTable[k];
      if (row) { chosenKey = k; chosenRow = row; break; }
    }

    return NextResponse.json({
      ok: true,
      context: ctx,
      chosen: {
        matchedKey: chosenKey ?? "(none)",
        subject: (chosenRow?.subject ?? "(none)"),
        htmlPreview: (chosenRow?.html ?? "").slice(0, 240),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
