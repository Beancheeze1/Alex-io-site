// app/api/demo/contact/route.ts
//
// Public endpoint — no auth required.
// Called when a prospect submits the "Get a real quote" form on the demo print page.
//
// What it does:
//   1. Validates the quote_no starts with Q-DEMO- (safety guard)
//   2. Updates the demo quote in DB:
//      - Sets status = 'lead_captured'
//      - Updates customer_name, email, phone, company from form
//   3. Sends a sales notification email via Microsoft Graph (MS_MAILBOX_FROM)
//      with all lead details + a direct admin link to the quote
//
// What it does NOT do:
//   - No session/auth check (public entry point)
//   - No HubSpot calls (can be added later)
//   - Does not touch any real Q-AI- quotes

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function buildLeadEmailHtml(fields: {
  quoteNo: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  userCount: string;
  productDescription: string;
  currentProcess: string;
  notes: string;
  adminUrl: string;
}): string {
  const f = fields;
  const row = (label: string, value: string) =>
    value.trim()
      ? `<tr>
           <td style="padding:8px 12px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
           <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:500">${escapeHtml(value)}</td>
         </tr>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:linear-gradient(90deg,#0ea5e9 0%,#22d3ee 35%,#6366f1 100%);padding:24px 28px">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.85);margin-bottom:6px">
        Alex-IO · Demo Lead
      </div>
      <div style="font-size:22px;font-weight:700;color:#fff">
        New quote request from demo flow
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px">
        ${escapeHtml(f.quoteNo)}
      </div>
    </div>

    <!-- Lead details table -->
    <div style="padding:24px 28px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#6b7280;margin-bottom:12px">
        Contact Details
      </div>
      <table style="width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <tbody>
          ${row("Name", f.name)}
          ${row("Email", f.email)}
          ${row("Phone", f.phone)}
          ${row("Company", f.company)}
          ${row("Users / seats needed", f.userCount)}
          ${row("What they're packaging", f.productDescription)}
          ${row("Current quoting process", f.currentProcess)}
          ${row("Notes", f.notes)}
        </tbody>
      </table>
    </div>

    <!-- CTA -->
    <div style="padding:0 28px 28px">
      <a
        href="${escapeHtml(f.adminUrl)}"
        style="display:inline-block;padding:12px 24px;background:#0f172a;color:#f9fafb;font-size:14px;font-weight:600;border-radius:999px;text-decoration:none"
      >
        View demo quote in admin →
      </a>
      <div style="margin-top:12px;font-size:12px;color:#9ca3af">
        This prospect completed the full demo flow: landing form → quote modal → layout editor → apply → print page.
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 28px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af">
      Sent by Alex-IO demo lead capture · ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const quoteNo = String(body.quoteNo ?? "").trim();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const company = String(body.company ?? "").trim();
    const userCount = String(body.userCount ?? "").trim();
    const productDescription = String(body.productDescription ?? "").trim();
    const currentProcess = String(body.currentProcess ?? "").trim();
    const notes = String(body.notes ?? "").trim();

    // Safety: only process demo quotes
    if (!quoteNo.startsWith("Q-DEMO-")) {
      return NextResponse.json(
        { ok: false, error: "INVALID_QUOTE", message: "Only Q-DEMO- quotes are accepted." },
        { status: 400 },
      );
    }

    if (!email || !name) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS", message: "name and email are required." },
        { status: 400 },
      );
    }

    // ── 1. Update quote in DB ─────────────────────────────────────────────────
    // Mark as lead_captured and update contact details from the form.
    // Use COALESCE so we don't overwrite existing values with blanks.
    await one(
      `
      UPDATE public."quotes"
      SET
        status       = 'lead_captured',
        customer_name = CASE WHEN $2 <> '' THEN $2 ELSE customer_name END,
        email        = CASE WHEN $3 <> '' THEN $3 ELSE email END,
        phone        = CASE WHEN $4 <> '' THEN $4 ELSE phone END,
        company      = CASE WHEN $5 <> '' THEN $5 ELSE company END,
        updated_at   = now()
      WHERE quote_no = $1
        AND is_demo  = true
      RETURNING id
      `,
      [quoteNo, name, email, phone, company],
    );

    // ── 2. Send sales notification email ─────────────────────────────────────
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const adminUrl = `${baseUrl}/admin/quotes/${encodeURIComponent(quoteNo)}`;
    const salesEmail = process.env.MS_MAILBOX_FROM || process.env.SALES_NOTIFY_EMAIL || "";

    let emailSent = false;
    let emailError: string | null = null;

    if (salesEmail) {
      try {
        const html = buildLeadEmailHtml({
          quoteNo,
          name,
          email,
          phone,
          company,
          userCount,
          productDescription,
          currentProcess,
          notes,
          adminUrl,
        });

        await sendGraphEmail({
          to: salesEmail,
          subject: `New demo lead: ${name}${company ? ` · ${company}` : ""} — ${quoteNo}`,
          html,
        });

        emailSent = true;
      } catch (err: any) {
        // Non-fatal: DB update succeeded, email is best-effort
        emailError = String(err?.message ?? err);
        console.error("[demo/contact] Email send failed:", emailError);
      }
    } else {
      console.warn("[demo/contact] No sales email configured (MS_MAILBOX_FROM / SALES_NOTIFY_EMAIL)");
    }

    return NextResponse.json({
      ok: true,
      quoteNo,
      status: "lead_captured",
      emailSent,
      emailError: emailError ?? undefined,
    });
  } catch (err: any) {
    console.error("[demo/contact] Error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}