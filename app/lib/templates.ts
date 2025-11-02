// app/lib/templates.ts
/**
 * Flexible template picker for Alex-IO auto-replies.
 *
 * Source of truth is REPLY_TEMPLATES_JSON env (JSON object). Keys you can use:
 *   - "default"                                 -> global default
 *   - "inbox:<email-address>"                   -> e.g., "inbox:sales@alex-io.com"
 *   - "inboxId:<id>"                            -> numeric/string ID from HubSpot
 *   - "channelId:<id>"                          -> HubSpot channelId if present
 *
 * Value shape:
 *   { "subject": "...", "html": "<p>...</p>" }
 *
 * Fallback order (first match wins):
 *   inbox:<email>  -> inboxId:<id> -> channelId:<id> -> default
 *
 * NOTE: If REPLY_TEMPLATES_JSON is missing or invalid, we gracefully fall back
 *       to REPLY_TEMPLATE_HTML and REPLY_SUBJECT_PREFIX.
 */

export type ReplyTemplate = { subject?: string; html?: string };
export type TemplateContext = {
  inboxEmail?: string | null;
  inboxId?: string | number | null;
  channelId?: string | number | null;
};

function parseJsonEnv(name: string): any | null {
  const raw = process.env[name];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function pickTemplate(ctx: TemplateContext): ReplyTemplate {
  const table = parseJsonEnv("REPLY_TEMPLATES_JSON") || {};

  const tryKeys: string[] = [];
  if (ctx?.inboxEmail) tryKeys.push(`inbox:${String(ctx.inboxEmail).toLowerCase()}`);
  if (ctx?.inboxId != null) tryKeys.push(`inboxId:${String(ctx.inboxId)}`);
  if (ctx?.channelId != null) tryKeys.push(`channelId:${String(ctx.channelId)}`);
  tryKeys.push("default");

  for (const k of tryKeys) {
    const v = table[k];
    if (v && typeof v === "object") {
      return { subject: v.subject, html: v.html };
    }
  }

  // Legacy fallbacks
  const subjectPrefix = (process.env.REPLY_SUBJECT_PREFIX || "").trim();
  const subject = subjectPrefix ? `${subjectPrefix} Thanks for your message` : undefined;
  const html = (process.env.REPLY_TEMPLATE_HTML || "").trim() ||
    `<p>Thanks for reaching out to Alex-IO. We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;

  return { subject, html };
}
