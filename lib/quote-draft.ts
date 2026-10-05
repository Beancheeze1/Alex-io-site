// lib/quote-draft.ts
//
// Find the quote for an upload, or (public layout editor, before the
// buyer's first "Apply to quote") create an empty draft so the file has
// something to attach to. "Apply to quote" still requires name + email;
// Apply fills in the draft's customer details later.
//
// Only brand-new customer numbers (Q-A-YYMMDD-NNNNN, issued by
// /api/public/quote-number) may create a draft. Tenant: a real tenant
// subdomain wins; on the core host the editor's tenant_slug is used;
// otherwise the host.

import { one } from "@/lib/db";
import { resolveTenantFromHost } from "@/lib/tenant";

const NEW_CUSTOMER_QUOTE_RE = /^Q-A-\d{6}-\d{5}$/;
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export const DRAFT_CUSTOMER_NAME = "Draft – no contact yet";

type QuoteRef = { id: number; quote_no: string };

export async function findOrCreateUploadDraft(
  req: Request,
  args: { quoteNo: string; tenantSlug?: string | null; quoteSource?: string | null },
): Promise<(QuoteRef & { created: boolean }) | null> {
  const quoteNo = String(args.quoteNo || "").trim();
  if (!quoteNo) return null;

  const existing = await one<QuoteRef>(
    `SELECT id, quote_no FROM public."quotes" WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (existing) return { ...existing, created: false };

  if (!NEW_CUSTOMER_QUOTE_RE.test(quoteNo)) return null;

  const fromHeader = (req.headers.get("x-tenant-slug") || "").trim().toLowerCase();
  const fromBody = String(args.tenantSlug || "").trim().toLowerCase();
  const slug =
    fromHeader && fromHeader !== "default"
      ? fromHeader
      : SLUG_RE.test(fromBody)
        ? fromBody
        : fromHeader;

  const tenant = slug
    ? await one<{ id: number }>(
        `SELECT id FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`,
        [slug],
      )
    : await resolveTenantFromHost(req.headers.get("host"));
  if (!tenant) return null;

  const quoteSource = args.quoteSource === "embed_website" ? "embed_website" : "direct";

  const created = await one<QuoteRef>(
    `
    INSERT INTO public."quotes"
      (tenant_id, quote_no, status, customer_name, locked, is_demo, quote_source)
    VALUES ($1, $2, 'draft', $3, false, false, $4)
    ON CONFLICT (quote_no) DO NOTHING
    RETURNING id, quote_no
    `,
    [tenant.id, quoteNo, DRAFT_CUSTOMER_NAME, quoteSource],
  );
  if (created) return { ...created, created: true };

  // Lost a race with a concurrent request: use the row that won.
  const again = await one<QuoteRef>(
    `SELECT id, quote_no FROM public."quotes" WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  return again ? { ...again, created: false } : null;
}
