// app/api/quotes/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { loadFacts } from "@/app/lib/memory";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { findOrCreateCustomer } from "@/app/lib/customers";
import { commissionChoice, resolveCommission } from "@/app/lib/account-rep-core";
import { customerAccountRepId, markRepSetByStaff } from "@/app/lib/account-rep";
import { displayRevisionLabel } from "@/app/lib/revision-label";
import { isInternalCall } from "@/lib/internal-call";

// GET /api/quotes?limit=25
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 200);

    const user = await getCurrentUserFromRequest(req as any);

    // Enforce tenant host -> session tenant match (A2 subdomain multi-tenant)
    const enforced = await enforceTenantMatch(req as any, user);
    if (!enforced.ok) {
      return NextResponse.json(enforced.body, { status: enforced.status });
    }

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", message: "Login required." },
        { status: 401 },
      );
    }

    // Only internal roles should read quotes here.
    const isAdminOrCS = isRoleAllowed(user, ["admin", "cs"]);
    const isSales = isRoleAllowed(user, ["sales"]);

    if (!isAdminOrCS && !isSales) {
      return NextResponse.json(
        { ok: false, error: "forbidden", message: "Not allowed." },
        { status: 403 },
      );
    }

    if (isSales) {
      // Sales can only see their own quotes (AND within their tenant).
      const rows = await q(
        `
        SELECT q.id,
               q.quote_no,
               q.customer_name,
               q.email,
               q.phone,
               q.status,
               q.sales_rep_id,
               u.name AS sales_rep_name,
               q.locked,
               q.geometry_hash,
               q.locked_at,
               q.created_at,
               q.updated_at
        FROM public."quotes" q
        LEFT JOIN public."users" u
          ON u.id = q.sales_rep_id
        WHERE q.tenant_id = $1
          AND q.sales_rep_id = $2
        ORDER BY q.created_at DESC
        LIMIT $3
      `,
        [user.tenant_id, user.id, limit],
      );

      const withRevision = await Promise.all(
        (rows as any[]).map(async (r) => {
          const facts = await loadFacts(String(r.quote_no));
          // displayRevisionLabel strips a trailing "S" once locked (and
          // prefers released_rev) -- see app/lib/revision-label.ts. Reading
          // facts.revision raw here (as this used to) could show an
          // "S"-suffixed label for an already-released quote.
          const revision = displayRevisionLabel(facts as any, !!r.locked);
          // Step 17: boxes-only quotes have no layout editor (Revise opens the quote page).
          const boxes_only = (facts as { pack_type?: unknown } | null)?.pack_type === "boxes_only";
          return { ...r, revision, boxes_only };
        }),
      );

      return NextResponse.json({ ok: true, quotes: withRevision });
    }

    // Admin + CS: all quotes (within tenant)
    const rows = await q(
      `
      SELECT q.id,
             q.quote_no,
             q.customer_name,
             q.email,
             q.phone,
             q.status,
             q.sales_rep_id,
             u.name AS sales_rep_name,
             q.locked,
             q.geometry_hash,
             q.locked_at,
             q.created_at,
             q.updated_at,
             q.customer_id
      FROM public."quotes" q
      LEFT JOIN public."users" u
        ON u.id = q.sales_rep_id
      WHERE q.tenant_id = $1
      ORDER BY q.created_at DESC
      LIMIT $2
    `,
      [user.tenant_id, limit],
    );

    const withRevision = await Promise.all(
      (rows as any[]).map(async (r) => {
        const facts = await loadFacts(String(r.quote_no));
        // displayRevisionLabel strips a trailing "S" once locked (and
        // prefers released_rev) -- see app/lib/revision-label.ts. Reading
        // facts.revision raw here (as this used to) could show an
        // "S"-suffixed label for an already-released quote.
        const revision = displayRevisionLabel(facts as any, !!r.locked);
        // Step 17: boxes-only quotes have no layout editor (Revise opens the quote page).
        const boxes_only = (facts as { pack_type?: unknown } | null)?.pack_type === "boxes_only";
        return { ...r, revision, boxes_only };
      }),
    );

    return NextResponse.json({ ok: true, quotes: withRevision });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}

// POST /api/quotes
// Request shape (now supports rep attribution):
// {
//   "quote_no": "Q-API-001",
//   "customer_name": "Acme",
//   "email": "a@b.com",
//   "phone": "555-1234",
//   "status": "draft",
//   "sales_rep_id": 2,          // optional, direct id (admin tools)
//   "sales_rep_slug": "chuck"   // optional, looked up via users.sales_slug (tenant-scoped)
//   "tenant_id": 1              // Step 28B: internal calls only (email/AI quotes)
// }
// Callers: staff (admin / cs / sales) for their own shop, or Step 28B an
// internal server call (x-alexio-internal) that names the shop in tenant_id.
export async function POST(req: NextRequest) {
  try {
    const internal = isInternalCall(req);
    const body = (await req.json().catch(() => ({}))) || {};

    let tenantId: number;
    let user: Awaited<ReturnType<typeof getCurrentUserFromRequest>> | null = null;
    if (internal) {
      // Step 28B: email / AI quotes (app/api/ai/orchestrate) create their
      // quote row here; the caller names the quote's shop.
      tenantId = Number(body?.tenant_id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return NextResponse.json(
          { ok: false, error: "missing_tenant", message: "tenant_id is required on internal calls." },
          { status: 400 },
        );
      }
    } else {
      user = await getCurrentUserFromRequest(req);

      // Enforce tenant host -> session tenant match (A2 subdomain multi-tenant)
      const enforced = await enforceTenantMatch(req, user);
      if (!enforced.ok) {
        return NextResponse.json(enforced.body, { status: enforced.status });
      }

      if (!user) {
        return NextResponse.json(
          { ok: false, error: "unauthorized", message: "Login required." },
          { status: 401 },
        );
      }

      // Only internal roles can create quotes here.
      const canCreate = isRoleAllowed(user, ["admin", "cs", "sales"]);
      if (!canCreate) {
        return NextResponse.json(
          { ok: false, error: "forbidden", message: "Not allowed." },
          { status: 403 },
        );
      }
      tenantId = Number(user.tenant_id);
    }

    const {
      quote_no,
      customer_name,
      email = null,
      phone = null,
      status = "draft",
      sales_rep_id: rawSalesRepId,
      sales_rep_slug: rawSalesRepSlug,
      po_number = null,
      is_rush = false,
      qty: rawQty = null,
      qty_breaks: rawQtyBreaks = null,
      internal_notes = null,
      commission_to: rawCommissionTo = null, // Step 39O: "none" = staff chose no commission
    } = body;
    const choice = commissionChoice(rawCommissionTo, rawSalesRepId, rawSalesRepSlug);

    const qty =
      rawQty !== null && rawQty !== undefined && Number.isFinite(Number(rawQty))
        ? Number(rawQty)
        : null;

    const qtyBreaksJson =
      Array.isArray(rawQtyBreaks) && rawQtyBreaks.length ? JSON.stringify(rawQtyBreaks) : null;

    if (!quote_no || !customer_name) {
      return NextResponse.json(
        { ok: false, error: "quote_no and customer_name are required" },
        { status: 400 },
      );
    }

    // Resolve sales_rep_id:
    // 1) If a numeric id was provided, trust it (but keep within tenant by constraining the upsert).
    // 2) Else, if a slug was provided, look up users.id where sales_slug = slug AND tenant_id = current tenant.
    // 3) Else, if the caller is SALES, default to their own user.id.
    //    Step 39O: (2b) the customer's account rep comes before (3); "No
    //    commission" from the form leaves it empty (resolveCommission below).
    let salesRepId: number | null = null;

    if (
      rawSalesRepId !== undefined &&
      rawSalesRepId !== null &&
      Number.isFinite(Number(rawSalesRepId))
    ) {
      salesRepId = Number(rawSalesRepId);
    } else if (rawSalesRepSlug) {
      const slug = String(rawSalesRepSlug).trim();
      if (slug) {
        try {
          const userRow = await one<any>(
            `
            SELECT id
            FROM public."users"
            WHERE tenant_id = $1
              AND sales_slug = $2
            LIMIT 1;
          `,
            [tenantId, slug],
          );
          if (userRow && userRow.id) {
            salesRepId = Number(userRow.id);
          }
        } catch {
          // If lookup fails, we just proceed without assigning a rep.
          salesRepId = null;
        }
      }
    } else if (user) {
      // Default assignment for SALES creators.
      const role = (user.role || "").toLowerCase();
      if (role === "sales") {
        salesRepId = Number(user.id);
      }
    }

    // Link this quote to a real customer record — find-or-create by
    // normalized email (see app/lib/customers.ts for why this is
    // deliberately email-only, not fuzzy name-matching). Returns null when
    // no email was provided at all; the quote is simply left unlinked in
    // that case rather than guessing at an identity.
    const customer = await findOrCreateCustomer(tenantId, {
      name: customer_name,
      email,
      phone,
    });

    // Step 39O: the commission rule (app/lib/account-rep-core.ts).
    const resolved = resolveCommission({
      choice,
      namedRepId: choice === "named" ? salesRepId : null,
      accountRepId: choice === "auto" ? await customerAccountRepId(tenantId, customer?.id) : null,
      creator: user ? { id: Number(user.id), role: String(user.role || "") } : null,
    });
    salesRepId = resolved.repId;

    // Tenant-scoped upsert: quote_no unique is global today, so we must prevent cross-tenant overwrite.
    // We enforce tenant_id in insert and also in ON CONFLICT by keeping tenant_id unchanged.
    const row = await one(
      `
      INSERT INTO public."quotes"(
        tenant_id,
        quote_no,
        customer_name,
        email,
        phone,
        status,
        sales_rep_id,
        po_number,
        is_rush,
        qty,
        qty_breaks,
        internal_notes,
        customer_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (quote_no) DO UPDATE
        SET customer_name = EXCLUDED.customer_name,
            email         = EXCLUDED.email,
            phone         = EXCLUDED.phone,
            status        = EXCLUDED.status,
            -- keep tenant_id stable (never cross-tenant)
            tenant_id     = public."quotes".tenant_id,
            -- Only update sales_rep_id if a new non-null value was provided;
            -- otherwise keep the existing assignment.
            sales_rep_id  = COALESCE(EXCLUDED.sales_rep_id, public."quotes".sales_rep_id),
            po_number     = COALESCE(EXCLUDED.po_number, public."quotes".po_number),
            is_rush       = EXCLUDED.is_rush,
            qty           = COALESCE(EXCLUDED.qty, public."quotes".qty),
            qty_breaks    = COALESCE(EXCLUDED.qty_breaks, public."quotes".qty_breaks),
            internal_notes = COALESCE(EXCLUDED.internal_notes, public."quotes".internal_notes),
            customer_id   = COALESCE(public."quotes".customer_id, EXCLUDED.customer_id),
            updated_at    = now()
      WHERE public."quotes".tenant_id = $1
      RETURNING id,
                tenant_id,
                quote_no,
                customer_name,
                email,
                phone,
                status,
                sales_rep_id,
                po_number,
                is_rush,
                qty,
                qty_breaks,
                internal_notes,
                customer_id,
                locked,
                geometry_hash,
                locked_at,
                created_at,
                updated_at
    `,
      [
        tenantId,
        quote_no,
        customer_name,
        email,
        phone,
        status,
        salesRepId,
        po_number,
        !!is_rush,
        qty,
        qtyBreaksJson,
        internal_notes,
        customer?.id ?? null,
      ],
    );

    if (!row) {
      // Conflict existed but belonged to a different tenant.
      return NextResponse.json(
        {
          ok: false,
          error: "tenant_conflict",
          message: "Quote number already exists in another tenant.",
        },
        { status: 409 },
      );
    }

    // Step 39O: staff chose the rep on the form: the account rep never overrides it later.
    if (resolved.setByStaff && (row as { id?: number }).id) await markRepSetByStaff(Number((row as { id: number }).id), tenantId);

    return NextResponse.json({ ok: true, quote: row }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
