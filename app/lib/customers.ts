// app/lib/customers.ts
//
// Shared customer find-or-create logic. Used by:
//   - app/api/quotes/route.ts, at the moment a quote is created, so every
//     quote gets linked to a real customer record rather than relying on
//     text-matching customer_name/email at search time.
//   - scripts/backfill-customers.mjs, for existing quotes created before
//     this system existed.
//
// Matching key is normalized email only (lowercase, trimmed) — deliberately
// NOT fuzzy name-matching. A wrong fuzzy match silently merges two
// different people's quote history together, which is a real data
// integrity problem; failing to match two records for the same person
// (they used two different emails) just means they show up as two
// customers, which is a minor, obviously-fixable inconvenience by
// comparison. When in doubt, this errs toward not merging.

import { one, q } from "@/lib/db";

export type CustomerRow = {
  id: number;
  tenant_id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
};

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Find an existing customer by normalized email (tenant-scoped), or create
 * one from the given details. Returns null only when no email was provided
 * at all — there's no reliable key to find-or-create against in that case,
 * so the quote is simply left unlinked rather than guessing.
 */
export async function findOrCreateCustomer(
  tenantId: number,
  details: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  },
): Promise<CustomerRow | null> {
  const email = normalizeEmail(details.email);
  if (!email) return null;

  const existing = await one<CustomerRow>(
    `select id, tenant_id, name, email, phone, company
     from public.customers
     where tenant_id = $1 and lower(email) = $2
     limit 1`,
    [tenantId, email],
  );

  if (existing) {
    // Backfill any newly-provided details onto an existing sparse record
    // (e.g. a customer created with just an email now has a phone number
    // too) — never overwrite a value that's already set with something
    // different, just fill in genuine gaps.
    const name = details.name?.trim() || null;
    const phone = details.phone?.trim() || null;
    const company = details.company?.trim() || null;

    if (
      (name && !existing.name) ||
      (phone && !existing.phone) ||
      (company && !existing.company)
    ) {
      const rows = await q<CustomerRow>(
        `update public.customers
         set name = coalesce(name, $1),
             phone = coalesce(phone, $2),
             company = coalesce(company, $3),
             updated_at = now()
         where id = $4
         returning id, tenant_id, name, email, phone, company`,
        [name, phone, company, existing.id],
      );
      return rows[0] ?? existing;
    }

    return existing;
  }

  const rows = await q<CustomerRow>(
    `insert into public.customers (tenant_id, name, email, phone, company)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, lower(email)) where email is not null do update
       set updated_at = now()
     returning id, tenant_id, name, email, phone, company`,
    [
      tenantId,
      details.name?.trim() || null,
      email,
      details.phone?.trim() || null,
      details.company?.trim() || null,
    ],
  );

  return rows[0] ?? null;
}
