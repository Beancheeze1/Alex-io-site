// app/api/admin/customers/[id]/route.ts
//
// GET /api/admin/customers/:id
// Returns one customer plus every quote linked to them (newest first),
// each quote carrying its current revision label — the same data the
// admin quotes list and quote detail page already show, just grouped by
// customer rather than requiring you to already know a quote number.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { loadFacts } from "@/app/lib/memory";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: number;
  tenant_id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  created_at: string;
};

type QuoteRow = {
  id: number;
  quote_no: string;
  status: string | null;
  locked: boolean | null;
  created_at: string;
  updated_at: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const customer = (await one<CustomerRow>(
    `select id, tenant_id, name, email, phone, company, created_at
     from public.customers
     where id = $1 and tenant_id = $2`,
    [customerId, user.tenant_id],
  )) as CustomerRow | null;

  if (!customer) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const quotes = (await q<QuoteRow>(
    `select id, quote_no, status, locked, created_at, updated_at
     from public."quotes"
     where customer_id = $1 and tenant_id = $2
     order by created_at desc`,
    [customerId, user.tenant_id],
  )) as QuoteRow[];

  // Revision label for each quote — same source (Redis facts) the quotes
  // list and quote detail page already use, not a new concept.
  const quotesWithRevision = await Promise.all(
    quotes.map(async (row) => {
      let revision: string | null = null;
      try {
        const facts = await loadFacts(row.quote_no);
        revision = (facts as any)?.revision ?? (facts as any)?.stage_rev ?? null;
      } catch {
        revision = null;
      }
      return { ...row, revision };
    }),
  );

  return NextResponse.json({
    ok: true,
    customer,
    quotes: quotesWithRevision,
  });
}
