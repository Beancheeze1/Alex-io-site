// scripts/backfill-customers.mjs
//
// One-time backfill: links existing quotes (created before the customers
// table existed) to a real customer record, grouped by exact,
// case-insensitive email match — deliberately NOT fuzzy name-matching. See
// app/lib/customers.ts for why: a wrong fuzzy match silently merges two
// different people's quote history together, which is a real data
// integrity problem, whereas under-matching just leaves someone split
// across two customer records — a minor, easily-fixable inconvenience by
// comparison.
//
// Usage:
//   node scripts/backfill-customers.mjs            # dry run — reports what it WOULD do, writes nothing
//   node scripts/backfill-customers.mjs --apply     # actually creates customers and links quotes
//
// Requires DATABASE_URL in the environment (same as running the app locally).

import pg from "pg";

const APPLY = process.argv.includes("--apply");

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error("Missing DATABASE_URL in environment.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

  try {
    const { rows: groups } = await pool.query(`
      select tenant_id, lower(email) as email_lc, count(*) as quote_count,
             array_agg(quote_no order by created_at asc) as quote_nos,
             (array_agg(customer_name order by created_at asc))[1] as sample_name,
             (array_agg(phone order by created_at asc) filter (where phone is not null))[1] as sample_phone
      from public."quotes"
      where email is not null
        and customer_id is null
      group by tenant_id, lower(email)
      order by tenant_id, email_lc
    `);

    console.log(`Found ${groups.length} distinct (tenant, email) group(s) needing a customer record.\n`);

    let created = 0;
    let linked = 0;

    for (const g of groups) {
      console.log(
        `${APPLY ? "" : "[dry run] "}tenant ${g.tenant_id} · ${g.email_lc} · ${g.quote_count} quote(s): ${g.quote_nos.join(", ")}`,
      );

      if (!APPLY) continue;

      const existing = await pool.query(
        `select id from public.customers where tenant_id = $1 and lower(email) = $2 limit 1`,
        [g.tenant_id, g.email_lc],
      );

      let customerId;
      if (existing.rows[0]) {
        customerId = existing.rows[0].id;
      } else {
        const inserted = await pool.query(
          `insert into public.customers (tenant_id, name, email, phone)
           values ($1, $2, $3, $4)
           returning id`,
          [g.tenant_id, g.sample_name || null, g.email_lc, g.sample_phone || null],
        );
        customerId = inserted.rows[0].id;
        created += 1;
      }

      const result = await pool.query(
        `update public."quotes"
         set customer_id = $1
         where tenant_id = $2 and lower(email) = $3 and customer_id is null`,
        [customerId, g.tenant_id, g.email_lc],
      );

      linked += result.rowCount ?? 0;
    }

    console.log(
      `\n${APPLY ? "Done." : "Dry run complete — nothing written."} ${
        APPLY ? `Created ${created} customer(s), linked ${linked} quote(s).` : "Re-run with --apply to actually write."
      }`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
