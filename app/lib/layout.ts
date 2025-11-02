// app/lib/layout.ts
// Lightweight, email-safe HTML wrapper for branded replies.

type WrapOpts = {
  brandName?: string;
  logoUrl?: string;
  primary?: string;    // hex or named color
  footerHtml?: string; // small-print or address block
};

function env(n: string, d = "") { return (process.env[n] ?? d).toString(); }

export function shouldWrap(): boolean {
  const v = (process.env.REPLY_BRAND_WRAPPER ?? "false").toString().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getBrandOpts(): WrapOpts {
  return {
    brandName: env("BRAND_NAME", "Alex-IO"),
    logoUrl: env("BRAND_LOGO_URL", ""),               // e.g. https://alex-io.com/logo.png
    primary: env("BRAND_PRIMARY", "#111827"),         // Tailwind slate-900 by default
    footerHtml: env("BRAND_FOOTER_HTML", ""),         // optional HTML
  };
}

/** Wraps inner HTML with a simple, inline-styled, table-based layout for email clients. */
export function wrapHtml(innerHtml: string, incoming?: Partial<WrapOpts>): string {
  const o = { ...getBrandOpts(), ...(incoming || {}) };
  const logoImg = o.logoUrl
    ? `<tr><td style="padding:0 0 12px 0;"><img src="${o.logoUrl}" alt="${o.brandName}" style="height:36px; display:block;"></td></tr>`
    : "";

  const footer = o.footerHtml
    ? `<tr><td style="padding-top:24px; color:#6b7280; font-size:12px; line-height:18px;">${o.footerHtml}</td></tr>`
    : "";

  const safeInner = innerHtml || "";

  return `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f8fafc;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.06); overflow:hidden;">
            <tr>
              <td style="background:${o.primary}; padding:12px 20px;">
                <table width="100%"><tr>
                  <td style="color:#ffffff; font-family:Segoe UI,Arial,sans-serif; font-size:16px; font-weight:600;">
                    ${o.brandName}
                  </td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px; font-family:Segoe UI,Arial,sans-serif; font-size:15px; line-height:22px; color:#111827;">
                <table width="100%" role="presentation" cellpadding="0" cellspacing="0" border="0">
                  ${logoImg}
                  <tr><td>${safeInner}</td></tr>
                  ${footer}
                </table>
              </td>
            </tr>
          </table>
          <div style="height:24px;"></div>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}
