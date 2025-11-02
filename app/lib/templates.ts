// app/lib/templates.ts
// Minimal, typed template resolver used by the webhook and admin preview.

export type ReplyTemplate = { subject?: string; html?: string };
export type TemplateContext = {
  inboxEmail?: string | null;
  inboxId?: string | number | null;
  channelId?: string | number | null;
};

type TemplateRow = { subject?: string; html?: string };
type TemplateTable = Record<string, TemplateRow>;

function parseJsonEnv(name: string): TemplateTable | null {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as TemplateTable) : null;
  } catch {
    return null;
  }
}

function fallbackTemplate(): ReplyTemplate {
  const prefix = (process.env.REPLY_SUBJECT_PREFIX || "").trim();
  const subject = prefix ? `${prefix} Thanks for your message` : undefined;
  const html =
    (process.env.REPLY_TEMPLATE_HTML || "").trim() ||
    `<p>Thanks for reaching out to Alex-IO. We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;
  return { subject, html };
}

/** Original simple picker (kept for compatibility) */
export function pickTemplate(ctx: TemplateContext): ReplyTemplate {
  const { template } = pickTemplateWithKey(ctx);
  return template;
}

/** New: return both the matched key and the template */
export function pickTemplateWithKey(ctx: TemplateContext): { key: string; template: ReplyTemplate } {
  const table = parseJsonEnv("REPLY_TEMPLATES_JSON");
  const tryKeys: string[] = [];
  if (ctx?.inboxEmail) tryKeys.push(`inbox:${String(ctx.inboxEmail).toLowerCase()}`);
  if (ctx?.inboxId != null) tryKeys.push(`inboxId:${String(ctx.inboxId)}`);
  if (ctx?.channelId != null) tryKeys.push(`channelId:${String(ctx.channelId)}`);
  tryKeys.push("default");

  if (!table) return { key: "(fallback)", template: fallbackTemplate() };

  for (const k of tryKeys) {
    const row = table[k];
    if (row && typeof row === "object") {
      return { key: k, template: { subject: row.subject, html: row.html ?? fallbackTemplate().html } };
    }
  }
  return { key: "(fallback)", template: fallbackTemplate() };
}
