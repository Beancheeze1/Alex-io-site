// app/api/admin/customers/[id]/route.ts
//
// GET /api/admin/customers/:id
// Step 39O: PATCH { account_rep_id } sets the customer's account rep (a staff
// user with a sales slug, or null); GET also returns account_rep_id.
// Returns one customer plus every quote linked to them (newest first),
// each quote carrying its current revision label — the same data the
// admin quotes list and quote detail page already show, just grouped by
// customer rather than requiring you to already know a quote number.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { loadFacts } from "@/app/lib/memory";
import { accountRepReady, customerAccountRepId, listReps } from "@/app/lib/account-rep";

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
    customer: { ...customer, account_rep_id: await customerAccountRepId(Number(user.tenant_id), customerId) },
    quotes: quotesWithRevision,
  });
}

// Step 39O: set (or clear) the customer's account rep. Admin of the shop.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const tenantId = Number(user.tenant_id);

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  if (!(await accountRepReady())) {
    return NextResponse.json(
      { ok: false, error: "not_ready", message: "Account reps need migration 051 (not run yet)." },
      { status: 409 },
    );
  }
  const body = (await req.json().catch(() => null)) as { account_rep_id?: unknown } | null;
  let repId: number | null = null;
  if (body?.account_rep_id !== null && body?.account_rep_id !== undefined && body?.account_rep_id !== "") {
    repId = Number(body.account_rep_id);
    const reps = await listReps(tenantId);
    if (!Number.isInteger(repId) || !reps.some((r) => r.id === repId)) {
      return NextResponse.json(
        { ok: false, error: "bad_rep", message: "Pick a team member who has a sales slug." },
        { status: 400 },
      );
    }
  }
  const row = await one<{ id: number }>(
    `update public.customers set account_rep_id = $1, updated_at = now()
      where id = $2 and tenant_id = $3 returning id`,
    [repId, customerId, tenantId],
  );
  if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, account_rep_id: repId });
}
