// app/lib/signature.ts
// Per-inbox / per-channel signature resolver.
// Reads SIGNATURES_JSON and optional SIGNATURE_FALLBACK_HTML from env.
// Lookup order: inboxEmail → inboxId → channelId → default → fallback.

export type SignatureRow = { html?: string };
type SignatureTable = Record<string, SignatureRow>;

function parseSignaturesEnv(name: string): SignatureTable | null {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SignatureTable;
  } catch {
    return null;
  }
}

const FALLBACK_HTML =
  (process.env.SIGNATURE_FALLBACK_HTML || "").trim() ||
  `<p style="margin:0;padding:0;">
    <strong>Alex-IO</strong><br/>
    <a href="https://alex-io.com">alex-io.com</a>
  </p>`;

export type SigContext = {
  inboxEmail?: string | null;
  inboxId?: string | number | null;
  channelId?: string | number | null;
};

/**
 * Pick best signature for the given context.
 * Returns { key, html } where key is the matched table key or "(fallback)".
 */
export function pickSignature(ctx: SigContext): { key: string; html: string } {
  const table = parseSignaturesEnv("SIGNATURES_JSON");
  if (!table) return { key: "(fallback)", html: FALLBACK_HTML };

  const keysToTry: string[] = [];

  if (ctx?.inboxEmail) {
    keysToTry.push(`inbox:${String(ctx.inboxEmail).toLowerCase()}`);
  }
  if (ctx?.inboxId != null) {
    keysToTry.push(`inboxId:${String(ctx.inboxId)}`);
  }
  if (ctx?.channelId != null) {
    keysToTry.push(`channelId:${String(ctx.channelId)}`);
  }
  keysToTry.push("default");

  for (const k of keysToTry) {
    const row = table[k];
    if (row && typeof row === "object") {
      const html = String(row.html || "").trim();
      if (html) return { key: k, html };
    }
  }
  return { key: "(fallback)", html: FALLBACK_HTML };
}
