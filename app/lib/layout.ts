// app/lib/layout.ts

export type WrapOpts = {
  subject: string;
  html: string;
  /** optional extras */
  headerHtml?: string;
  footerHtml?: string;
  brand?: string;
};

/**
 * Some deployments want raw HTML (no wrapper). Default is ON.
 * EMAIL_WRAP=off will skip wrapping.
 */
export function shouldWrap(): boolean {
  const v = (process.env.EMAIL_WRAP || "").toLowerCase().trim();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/**
 * Backwards-compatible wrapper:
 * - NEW preferred form: wrapHtml({ subject, html, ... })
 * - Legacy form:       wrapHtml(subject, html)
 *
 * TS will be happy either way, and we normalize internally.
 */
export function wrapHtml(opts: WrapOpts): string;
export function wrapHtml(subject: string, html: string): string;
export function wrapHtml(
  a: string | WrapOpts,
  b?: string
): string {
  let subject: string;
  let html: string;
  let headerHtml = "";
  let footerHtml = "";
  let brand = "Alex-IO";

  if (typeof a === "string") {
    // legacy call: wrapHtml(subject, html)
    subject = a;
    html = b ?? "";
  } else {
    // object call: wrapHtml({ subject, html, ... })
    subject = a.subject ?? "";
    html = a.html ?? "";
    headerHtml = a.headerHtml ?? "";
    footerHtml = a.footerHtml ?? "";
    brand = a.brand ?? brand;
  }

  // Simple, robust wrapper (no external CSS deps)
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(subject || brand)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>
      body { margin:0; padding:0; background:#f6f7fb; color:#0a0a0a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; }
      .container { max-width:680px; margin:24px auto; background:#fff; border-radius:16px; box-shadow: 0 8px 28px rgba(16,24,40,.06); overflow:hidden; }
      .header { padding:18px 24px; border-bottom:1px solid #eef1f6; display:flex; align-items:center; gap:12px; }
      .badge { font-size:12px; font-weight:600; letter-spacing:.04em; color:#2563eb; background:#eff6ff; border:1px solid #dbeafe; padding:2px 8px; border-radius:999px; }
      .title { margin:0; font-size:16px; font-weight:650; color:#0f172a; }
      .content { padding:24px; line-height:1.6; }
      .content p { margin:0 0 12px 0; }
      .footer { padding:16px 24px; font-size:12px; color:#6b7280; border-top:1px solid #eef1f6; background:#fafbfe; }
      .brand { font-weight:600; color:#111827; }
      a { color:#2563eb; text-decoration:none; }
      .muted { color:#6b7280; }
    </style>`,
    "</head>",
    "<body>",
    '<div class="container">',
    '<div class="header">',
    `<span class="badge">${escapeHtml(brand)}</span>`,
    `<h1 class="title">${escapeHtml(subject || brand)}</h1>`,
    "</div>",
    '<div class="content">',
    headerHtml || "",
    html || "",
    footerHtml || "",
    "</div>",
    `<div class="footer">© ${new Date().getFullYear()} <span class="brand">${escapeHtml(
      brand
    )}</span>. All rights reserved.</div>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
