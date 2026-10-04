// app/api/public/spec-request/route.ts
//
// Public "Send us your specs" submit for tenant pages (/t/[tenant]/specs).
// multipart/form-data: tenant, name, email, company, phone, notes, files (0-3),
// website (honeypot: must be empty).
// Saves the request + files in one transaction, then emails the shop and the
// buyer. Email outcomes are recorded on the row (never silent). Rate limited
// to 3 per minute per IP.

import { NextRequest, NextResponse } from "next/server";
import { one, q, withTxn } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { escapeHtml, sendHtmlEmail } from "@/lib/email/send-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  "pdf", "png", "jpg", "jpeg", "webp", "heic", "heif",
  "dxf", "dwg", "step", "stp", "igs", "iges", "stl",
]);
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function field(form: FormData, key: string, max: number): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function tenantHost(slug: string): string {
  return slug === "default" ? "api.alex-io.com" : `${slug}.api.alex-io.com`;
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 12px;color:#7A7A74;font-size:13px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 12px;color:#1C1C1A;font-size:13px;white-space:pre-line">${escapeHtml(value || "—")}</td></tr>`;
}

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 3, "spec-request");
  if (!rate.success) return rateLimitResponse(rate.reset);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("invalid_form", "We couldn't read the form. Please try again.");
  }

  // Honeypot: real people never fill this hidden field. Pretend success.
  if (field(form, "website", 200)) return NextResponse.json({ ok: true, id: null }, { status: 201 });

  const tenantSlug = field(form, "tenant", 63).toLowerCase();
  const name = field(form, "name", 200);
  const email = field(form, "email", 200).toLowerCase();
  const company = field(form, "company", 200);
  const phone = field(form, "phone", 60);
  const notes = field(form, "notes", 4000);

  if (!/^[a-z0-9-]{1,63}$/.test(tenantSlug)) return bad("invalid_tenant", "This page isn't set up for spec requests.");
  if (!name) return bad("missing_name", "Please enter your name.");
  if (!EMAIL_RE.test(email)) return bad("invalid_email", "Please enter a valid email address.");

  const files = form
    .getAll("files")
    .filter((f): f is File => typeof f === "object" && f !== null && typeof (f as File).arrayBuffer === "function" && (f as File).size > 0);

  if (!notes && files.length === 0) return bad("empty_request", "Attach a file or describe what you need.");
  if (files.length > MAX_FILES) return bad("too_many_files", `Attach up to ${MAX_FILES} files.`);

  let total = 0;
  for (const f of files) {
    total += f.size;
    if (!ALLOWED_EXT.has(extOf(f.name))) {
      return bad("file_type", `${f.name}: this file type isn't accepted. Use PDF, image, DXF, DWG, STEP, IGES or STL.`);
    }
  }
  if (total > MAX_TOTAL_BYTES) return bad("too_large", "Files must total 8 MB or less. For larger files, email us directly.");

  const tenant = await one<{ id: number; slug: string; name: string; theme_json: any }>(
    `SELECT id, slug, name, theme_json FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`,
    [tenantSlug],
  );
  if (!tenant) return bad("invalid_tenant", "This page isn't set up for spec requests.", 404);

  const th = tenant.theme_json && typeof tenant.theme_json === "object" ? tenant.theme_json : {};
  const brandName =
    (typeof th.brandName === "string" && th.brandName.trim()) || tenant.name || tenant.slug;
  const notifyTo =
    [th.specsEmail, th.email]
      .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
      .find((v: string) => EMAIL_RE.test(v)) || null;

  const fileData = await Promise.all(
    files.map(async (f) => ({
      name: f.name.slice(0, 200),
      type: (f.type || "application/octet-stream").slice(0, 100),
      size: f.size,
      data: Buffer.from(await f.arrayBuffer()),
    })),
  );
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || null;

  let requestId: number;
  try {
    requestId = await withTxn(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO public.spec_requests
           (tenant_id, name, email, company, phone, notes, source_ip, notify_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [tenant.id, name, email, company || null, phone || null, notes || null, ip, notifyTo ? "pending" : "no_recipient"],
      );
      const id = Number(r.rows[0].id);
      for (const f of fileData) {
        await tx.query(
          `INSERT INTO public.spec_request_files (spec_request_id, filename, content_type, size_bytes, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, f.name, f.type, f.size, f.data],
        );
      }
      return id;
    });
  } catch (err: any) {
    console.error("[spec-request] save failed:", err);
    return bad("save_failed", "We couldn't save your request. Please try again or email us directly.", 500);
  }

  // Emails run after the request is safely saved. Outcomes are recorded, never thrown.
  try {
    const fileList = fileData.length
      ? fileData.map((f) => `${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`).join("\n")
      : "None";

    if (notifyTo) {
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px">
<p style="font-size:16px;color:#1C1C1A;margin:0 0 12px"><strong>New spec request</strong> from your Quotes &amp; ordering page.</p>
<table style="border-collapse:collapse;border:1px solid #E4E4E0;width:100%">
${row("Name", name)}${row("Company", company)}${row("Email", email)}${row("Phone", phone)}${row("Notes", notes)}${row("Files", fileList)}
</table>
<p style="margin:16px 0"><a href="https://${tenantHost(tenant.slug)}/admin/spec-requests" style="background:#2B2B28;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Open spec requests</a></p>
<p style="font-size:12px;color:#7A7A74">Reply to this email to answer ${escapeHtml(name)} directly.</p>
</div>`;
      const res = await sendHtmlEmail({
        to: notifyTo,
        subject: `New spec request — ${name}${company ? ` (${company})` : ""}`,
        html,
        replyTo: email,
      });
      await q(
        `UPDATE public.spec_requests SET notify_status = $2, notify_error = $3, updated_at = now() WHERE id = $1`,
        [requestId, res.ok ? "sent" : "failed", res.ok ? null : res.error.slice(0, 1000)],
      );
      if (!res.ok) console.error("[spec-request] shop notification failed:", requestId, res.error);
    }

    const confirmHtml = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px">
<p style="font-size:16px;color:#1C1C1A">Hi ${escapeHtml(name)},</p>
<p style="font-size:14px;color:#4A4A45">Thanks — ${escapeHtml(brandName)} received your specs and will be in touch about your quote.</p>
<p style="font-size:13px;color:#7A7A74;white-space:pre-line">Files: ${escapeHtml(fileList)}</p>
</div>`;
    const conf = await sendHtmlEmail({
      to: email,
      subject: `We received your specs — ${brandName}`,
      html: confirmHtml,
      replyTo: notifyTo,
    });
    await q(
      `UPDATE public.spec_requests SET confirm_status = $2, confirm_error = $3, updated_at = now() WHERE id = $1`,
      [requestId, conf.ok ? "sent" : "failed", conf.ok ? null : conf.error.slice(0, 1000)],
    );
    if (!conf.ok) console.error("[spec-request] buyer confirmation failed:", requestId, conf.error);
  } catch (err: any) {
    console.error("[spec-request] post-save email step failed:", requestId, err);
  }

  return NextResponse.json({ ok: true, id: requestId }, { status: 201 });
}
