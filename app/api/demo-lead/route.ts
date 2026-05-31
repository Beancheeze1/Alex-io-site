import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

const TIERS = new Set(["Starter", "Pro", "Shop"]);

function truncate(val: unknown, max: number): string | null {
  if (val == null || val === "") return null;
  const s = String(val).trim();
  return s.slice(0, max) || null;
}

function ok() {
  return NextResponse.json({ ok: true });
}

function fail(error: string) {
  return NextResponse.json({ ok: false, error });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getGraphToken(): Promise<string> {
  const tenant = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const r = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );

  if (!r.ok) throw new Error(`Graph token error ${r.status}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

async function sendGraphEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const from = requireEnv("MS_MAILBOX_FROM");
  const token = await getGraphToken();
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}`;

  const createRes = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject: opts.subject,
      body: { contentType: "HTML", content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Graph create draft error ${createRes.status}`);
  }

  const draft = (await createRes.json()) as { id: string };

  const sendRes = await fetch(
    `${base}/messages/${encodeURIComponent(draft.id)}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!sendRes.ok) {
    throw new Error(`Graph send error ${sendRes.status}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Invalid request body");

    const { tier, name, email, company, phone, quote_no, annual_mode } = body as Record<string, unknown>;

    if (!tier || !TIERS.has(String(tier))) return fail("Invalid tier");

    const cleanName    = truncate(name, 200);
    const cleanEmail   = truncate(email, 200);
    if (!cleanName)  return fail("name is required");
    if (!cleanEmail) return fail("email is required");

    const cleanCompany = truncate(company, 200);
    const cleanPhone   = truncate(phone, 200);
    const cleanQuoteNo = truncate(quote_no, 50);
    const isAnnual     = Boolean(annual_mode);
    const cleanTier    = String(tier);

    await q(
      `INSERT INTO demo_leads
         (tier, name, email, company, phone, quote_no, annual_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [cleanTier, cleanName, cleanEmail, cleanCompany, cleanPhone, cleanQuoteNo, isAnnual],
    );

    const salesEmail = process.env.MS_MAILBOX_FROM || "";
    if (salesEmail) {
      try {
        const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(90deg,#0ea5e9 0%,#22d3ee 35%,#6366f1 100%);padding:24px 28px">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.85);margin-bottom:6px">Alex-IO · Pricing Page Lead</div>
      <div style="font-size:22px;font-weight:700;color:#fff">New ${cleanTier} plan interest</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px">${isAnnual ? "Annual billing selected" : "Monthly billing selected"}</div>
    </div>
    <div style="padding:24px 28px">
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <tbody>
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Name</td><td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${cleanName}</td></tr>
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Email</td><td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${cleanEmail}</td></tr>
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Company</td><td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${cleanCompany || "—"}</td></tr>
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Phone</td><td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${cleanPhone || "—"}</td></tr>
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Plan</td><td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${cleanTier} — ${isAnnual ? "Annual" : "Monthly"}</td></tr>
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Quote No</td><td style="padding:8px 12px;font-size:13px;font-weight:500;color:#111827">${cleanQuoteNo || "—"}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="padding:0 28px 28px">
      <a href="https://api.alex-io.com/admin/leads" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#f9fafb;font-size:14px;font-weight:600;border-radius:999px;text-decoration:none">View all leads in admin →</a>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af">Sent by Alex-IO demo lead capture · ${new Date().toLocaleString()}</div>
  </div>
</body>
</html>`;

        await sendGraphEmail({
          to: salesEmail,
          subject: `New demo lead: ${cleanName}${cleanCompany ? ` · ${cleanCompany}` : ""} — ${cleanTier} plan`,
          html,
        });
      } catch (err: any) {
        console.error("[demo-lead] Email send failed:", err?.message);
        // Non-fatal — lead is already saved to DB
      }
    }

    return ok();
  } catch {
    return fail("Server error");
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
