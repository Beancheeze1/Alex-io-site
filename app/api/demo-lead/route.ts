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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Invalid request body");

    const { tier, name, email, company, phone, quote_no, annual_mode } = body as Record<string, unknown>;

    if (!tier || !TIERS.has(String(tier))) return fail("Invalid tier");

    const cleanName  = truncate(name, 200);
    const cleanEmail = truncate(email, 200);
    if (!cleanName)  return fail("name is required");
    if (!cleanEmail) return fail("email is required");

    const cleanCompany  = truncate(company, 200);
    const cleanPhone    = truncate(phone, 200);
    const cleanQuoteNo  = truncate(quote_no, 50);
    const isAnnual      = Boolean(annual_mode);
    const cleanTier     = String(tier);

    await q(
      `INSERT INTO demo_leads
         (tier, name, email, company, phone, quote_no, annual_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [cleanTier, cleanName, cleanEmail, cleanCompany, cleanPhone, cleanQuoteNo, isAnnual],
    );

    try {
      const apiKey  = process.env.RESEND_API_KEY;
      const from    = process.env.RESEND_FROM_EMAIL;
      if (apiKey && from) {
        const subject = `New Demo Lead — ${cleanTier} Plan — ${cleanName}${cleanCompany ? ` @ ${cleanCompany}` : ""}`;
        const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });

        const html = `
<table style="font-family:sans-serif;font-size:14px;color:#222;border-collapse:collapse" cellpadding="8">
  <tr><td style="color:#888;white-space:nowrap">Tier</td><td><strong>${cleanTier}</strong></td></tr>
  <tr><td style="color:#888;white-space:nowrap">Name</td><td>${cleanName}</td></tr>
  <tr><td style="color:#888;white-space:nowrap">Email</td><td><a href="mailto:${cleanEmail}">${cleanEmail}</a></td></tr>
  <tr><td style="color:#888;white-space:nowrap">Company</td><td>${cleanCompany ?? "—"}</td></tr>
  <tr><td style="color:#888;white-space:nowrap">Phone</td><td>${cleanPhone ?? "—"}</td></tr>
  <tr><td style="color:#888;white-space:nowrap">Quote #</td><td>${cleanQuoteNo ?? "—"}</td></tr>
  <tr><td style="color:#888;white-space:nowrap">Billing</td><td>${isAnnual ? "Annual" : "Monthly"}</td></tr>
  <tr><td style="color:#888;white-space:nowrap">Submitted</td><td>${timestamp}</td></tr>
</table>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to: ["chuck@alex-io.com"], subject, html }),
        });
      }
    } catch {
      // Email failure never blocks the response
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
