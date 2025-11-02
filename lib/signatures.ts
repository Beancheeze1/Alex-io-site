// app/lib/signature.ts
export type SignatureRow = { html?: string };
type SignatureTable = Record<string, SignatureRow>;

function parse(name: string): SignatureTable | null {
  const raw = process.env[name];
  if (!raw) return null;
  try { return JSON.parse(raw) as SignatureTable; } catch { return null; }
}

const FALLBACK_HTML =
  (process.env.SIGNATURE_FALLBACK_HTML || "").trim() ||
  `<p style="margin:0;padding:0;">
    <strong>Alex-IO</strong><br/>
    Shelby–Mansfield Corridor<br/>
    <a href="https://alex-io.com">alex-io.com</a>
  </p>`;

export type SigContext = { inboxEmail?: string | null; inboxId?: string | number | null; channelId?: string | number | null };

export function pickSignature(ctx: SigContext): { key: string; html: string } {
  const table = parse("SIGNATURES_JSON");
  if (!table) return { key: "(fallback)", html: FALLBACK_HTML };

  const tryKeys: string[] = [];
  if (ctx?.inboxEmail) tryKeys.push(`inbox:${String(ctx.inboxEmail).toLowerCase()}`);
  if (ctx?.inboxId != null) tryKeys.push(`inboxId:${String(ctx.inboxId)}`);
  if (ctx?.channelId != null) tryKeys.push(`channelId:${String(ctx.channelId)}`);
  tryKeys.push("default");

  for (const k of tryKeys) {
    const row = table[k];
    if (row && typeof row === "object" && typeof row.html === "string" && row.html.trim().length > 0) {
      return { key: k, html: row.html };
    }
  }
  return { key: "(fallback)", html: FALLBACK_HTML };
}
