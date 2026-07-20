// scripts/delete-locked-quotes.mjs
//
// One-time cleanup: permanently deletes every LOCKED (Released for
// Manufacturing) quote and all its related data. This is deliberately a
// SEPARATE, standalone script — /admin/cleanup's own quote-deletion
// endpoint has a hard-coded safety rule that ALWAYS excludes locked
// quotes ("WHERE (q.locked IS NULL OR q.locked = false)"), and this script
// intentionally does not touch or weaken that guardrail. That protection
// stays in place for all future use of the admin tool; this script exists
// only for this specific, deliberate, one-time cleanup.
//
// THIS IS IRREVERSIBLE. There is no undo, no soft-delete, no trash. Every
// row this touches is gone permanently once run with --apply.
//
// Usage:
//   node scripts/delete-locked-quotes.mjs                      # dry run — lists what WOULD be deleted, writes nothing
//   node scripts/delete-locked-quotes.mjs --apply --confirm=DELETE-LOCKED-QUOTES
//                                                                # actually deletes — the --confirm phrase must match exactly
//
// Requires DATABASE_URL in the environment (same as running the app locally).
// Scoped to ALL tenants by default — pass --tenant=<id> to limit to one.

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const CONFIRM_PHRASE = "DELETE-LOCKED-QUOTES";
const confirmArg = process.argv.find((a) => a.startsWith("--confirm="));
const confirmedPhrase = confirmArg ? confirmArg.split("=")[1] : null;
const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
const tenantId = tenantArg ? Number(tenantArg.split("=")[1]) : null;

// Every table that references a quote, confirmed by grepping the actual
// current application code rather than assumed from memory — the existing
// /admin/cleanup tool's own cascade list predates several of these and is
// missing quote_box_selections, quote_items, and quote_attachments, which
// is worth fixing separately, but this script gets the full, current list.
const CHILD_TABLES = [
  "quote_box_selections",
  "quote_items",
  "quote_layout_packages",
  "quote_lines",
  "quote_attachments",
];

async function main() {
  if (APPLY && confirmedPhrase !== CONFIRM_PHRASE) {
    console.error(
      `--apply requires an exact --confirm=${CONFIRM_PHRASE} to run. This permanently deletes data with no undo.`,
    );
    process.exit(1);
  }

  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error("Missing DATABASE_URL in environment.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

  try {
    const params = [];
    let where = "locked = true";
    if (tenantId) {
      params.push(tenantId);
      where += ` and tenant_id = $${params.length}`;
    }

    const { rows: targets } = await pool.query(
      `select id, tenant_id, quote_no, customer_name, created_at
       from public."quotes"
       where ${where}
       order by tenant_id, created_at asc`,
      params,
    );

    if (targets.length === 0) {
      console.log("No locked quotes found — nothing to do.");
      return;
    }

    console.log(`${APPLY ? "" : "[dry run] "}${targets.length} locked quote(s) will be permanently deleted:\n`);
    for (const t of targets) {
      console.log(`  tenant ${t.tenant_id} · ${t.quote_no} · ${t.customer_name || "(no name)"} · created ${new Date(t.created_at).toLocaleDateString()}`);
    }

    if (!APPLY) {
      console.log(
        `\nDry run complete — nothing written. Re-run with --apply --confirm=${CONFIRM_PHRASE} to actually delete these.`,
      );
      return;
    }

    const ids = targets.map((t) => t.id);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const table of CHILD_TABLES) {
        const result = await client.query(
          `delete from public.${table} where quote_id = any($1::int[])`,
          [ids],
        );
        console.log(`  Deleted ${result.rowCount ?? 0} row(s) from ${table}`);
      }

      const quotesResult = await client.query(
        `delete from public."quotes" where id = any($1::int[])`,
        [ids],
      );
      console.log(`  Deleted ${quotesResult.rowCount ?? 0} row(s) from quotes`);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    console.log(
      `\nDone. ${targets.length} locked quote(s) and all related rows permanently deleted.`,
    );
    console.log(
      "\nNote: this did not touch each quote's Redis facts key (revision history, layout notes, etc.) or the customers table — those are separate stores. Let me know if you also want those cleared for these quotes.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
