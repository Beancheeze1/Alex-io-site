// lib/demo-alert.ts
//
// Step 48: the email sales gets when a visitor starts a landing-page demo
// quote (POST /api/demo/seed). Pure (no DB, no mail) so it can be tested.
// Until now these quotes arrived silently as "Demo Prospect" with no email.

export type DemoAlertInput = {
  quoteNo: string;
  L: number;
  W: number;
  H: number;
  qty: number;
  shipMode: string; // "box" | "mailer" | "unsure" | ...
  materialName: string;
  printed: boolean;
  customerName: string;
  customerEmail: string;
  company: string;
  notes: string;
  source: string; // "landing-demo", widget, ...
  referrer: string; // page the visitor came from (may be blank)
  adminBase: string; // e.g. https://api.alex-io.com
  when: Date;
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "?";
}

export function shipModeLabel(mode: string): string {
  if (mode === "box") return "Foam + box (RSC)";
  if (mode === "mailer") return "Foam + mailer";
  return "Foam insert only";
}

/**
 * Where the visitor came from, as a short label: chatgpt.com, google.com,
 * direct / unknown. Takes a full referrer URL or a utm_source word.
 */
export function referrerLabel(ref: string): string {
  const s = String(ref || "").trim().slice(0, 300);
  if (!s) return "direct / unknown";
  try {
    const host = new URL(s).host.replace(/^www\./i, "");
    return host || "direct / unknown";
  } catch {
    // a utm_source value such as "chatgpt.com" or "linkedin"
    return /^[a-z0-9.\-_]{2,60}$/i.test(s) ? s.toLowerCase() : "direct / unknown";
  }
}

const PLACEHOLDER_NAMES = new Set(["Demo Prospect", "Sample Customer"]);

export function buildDemoAlert(i: DemoAlertInput): { subject: string; html: string } {
  const who = i.customerName && !PLACEHOLDER_NAMES.has(i.customerName) ? i.customerName : "";
  const from = referrerLabel(i.referrer);
  const size = `${num(i.L)} × ${num(i.W)} × ${num(i.H)} in`;
  const subject =
    i.source === "landing-sample"
      ? `Demo sample opened via ${from}`
      : `Demo quote started: ${size}, qty ${i.qty.toLocaleString("en-US")}${who ? ` (${who})` : ""} via ${from}`;

  const rows: [string, string][] = [
    ["Quote", i.quoteNo],
    ["Size (L × W × H)", size],
    ["Quantity", i.qty.toLocaleString("en-US")],
    ["Type", shipModeLabel(i.shipMode)],
    ["Material", i.materialName || "default"],
  ];
  if (i.shipMode === "box" || i.shipMode === "mailer") rows.push(["Printed box", i.printed ? "Yes" : "No"]);
  if (who) rows.push(["Name", who]);
  if (i.customerEmail) rows.push(["Email", i.customerEmail]);
  if (i.company) rows.push(["Company", i.company]);
  if (i.notes) rows.push(["Notes", i.notes.slice(0, 500)]);
  rows.push(["Came from", from]);
  rows.push(["Entry", i.source || "landing-demo"]);

  const link = `${i.adminBase.replace(/\/+$/, "")}/admin/quotes/${encodeURIComponent(i.quoteNo)}`;
  const when = i.when.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;font-size:13px;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${escapeHtml(v)}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb">
      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6b7280">Alex-IO · Landing page demo</div>
      <div style="font-size:20px;font-weight:600;color:#111827;margin-top:4px">Someone started a demo quote</div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px">${escapeHtml(when)} (Eastern). These are the specs they started with; the quote page shows any changes they made in the editor.</div>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><tbody>${tr}</tbody></table>
    </div>
    <div style="padding:0 24px 24px">
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 20px;background:#111827;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">Open the quote</a>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af">No contact details unless the visitor typed them. Sent by the demo quote alert (DEMO_ALERT_TO).</div>
  </div>
</body></html>`;

  return { subject, html };
}
